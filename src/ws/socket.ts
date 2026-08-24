/**
 * WebSocket 封装：鉴权连接、心跳保活、断线自动重连。
 *
 * - 连接端点 ws://.../ws/{token}，token 为登录返回的 JWT。
 * - 鉴权失败（auth_error）为终态，停止重连。
 * - 意外断开按指数退避重连（1s → 2s → 4s … 上限 15s）。
 * - exclusive 连接（裁判/选手端）被同身份新连接顶掉时为终态（displaced，
 *   close 码 4001）：停止重连，由 UI 弹窗告知「已在其他窗口打开」。
 */
import { wsUrl } from "@/api/config";
import { notifySessionExpired } from "@/api/client";
import { isTokenExpired } from "@/utils/jwt";
import type { ClientMessage, ServerMessage } from "./protocol";

export type ConnStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "displaced";

const HEARTBEAT_MS = 25_000;

/** 被同身份（exclusive）新连接顶掉时的服务端关闭码，与后端 DISPLACED_CLOSE_CODE 对齐 */
const DISPLACED_CLOSE_CODE = 4001;

/** sendQueued 待发指令上限（超过丢最旧；导播指令幂等，丢了也会被后续覆盖对齐） */
const MAX_PENDING = 32;

export class MatchSocket {
  /** 由外部（store）注入的回调 */
  onMessage: (msg: ServerMessage) => void = () => {};
  onStatusChange: (status: ConnStatus) => void = () => {};

  status: ConnStatus = "idle";
  private ws: WebSocket | null = null;
  private token = "";
  private seat: string | undefined;
  private session: string | undefined;
  private exclusive = false;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** sendQueued 暂存的待发指令（连接建立后 flush） */
  private pending: ClientMessage[] = [];
  private shouldReconnect = false;
  private attempt = 0;
  /** 已被顶掉（displaced 终态标记：onclose 后状态保持 displaced 而非 closed） */
  private displaced = false;

  /** exclusive=1 的连接要求独占身份 key（账号+座位+比赛）：同 key 旧连接被顶掉 */
  connect(token: string, seat?: string, session?: string, exclusive = false): void {
    this.token = token;
    this.seat = seat;
    this.session = session;
    this.exclusive = exclusive;
    this.displaced = false;
    this.shouldReconnect = true;
    this.attempt = 0;
    this.open();
  }

  private open(): void {
    this.cleanupWs();
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(this.token, this.seat, this.session, this.exclusive));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus("open");
      this.flushPending();
      this.startHeartbeat();
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: ServerMessage | null = null;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "") as ServerMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== "string") return;
      // 被同身份新连接顶掉（exclusive 接管）：终态，停止重连（消息仍照常分发）
      if (msg.type === "displaced") {
        this.shouldReconnect = false;
        this.displaced = true;
        this.setStatus("displaced");
      }
      // 鉴权失败为终态，停止重连
      if (msg.type === "auth_error") {
        this.shouldReconnect = false;
        // 令牌确已过期（区别于「未被指派 / 座位冲突」等业务性拒绝）→ 统一登出跳登录；
        // 场景独立入口未注册处理器时不跳转，维持各端原有遮罩/mock 兜底
        if (isTokenExpired(this.token)) notifySessionExpired();
      }
      this.onMessage(msg);
    };

    ws.onerror = () => {
      // 错误细节由 onclose 统一处理（重连/状态切换）
    };

    ws.onclose = (ev: CloseEvent) => {
      this.stopHeartbeat();
      this.ws = null;
      // displaced 消息未送达（竞态丢帧）时凭关闭码兜底判定「被顶掉」
      if (ev.code === DISPLACED_CLOSE_CODE) {
        this.shouldReconnect = false;
        this.displaced = true;
      }
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      } else {
        this.setStatus(this.displaced ? "displaced" : "closed");
      }
    };
  }

  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 可排队的幂等指令发送（导播操控类专用）：连接未就绪时按序暂存，
   * 连接建立后立即补发（顺序保留，服务端按序折算状态）。断线窗口内点击
   * 切场景/倒计时/配置不再静默丢失。普通业务消息仍走 send()（不排队，
   * 避免重放过期的裁判/选手动作）。
   */
  sendQueued(msg: ClientMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.send(msg);
    }
    this.pending.push(msg);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return false;
  }

  /** 连接建立后按序补发暂存指令（send 失败说明又断开，剩余保序留待下次 open） */
  private flushPending(): void {
    while (this.pending.length > 0) {
      const m = this.pending[0];
      if (!this.send(m)) return;
      this.pending.shift();
    }
  }

  /** 主动断开，不再重连 */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.pending.length = 0;
    this.stopHeartbeat();
    this.cleanupWs();
    this.setStatus("closed");
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.hbTimer = setInterval(() => {
      this.send({ type: "heartbeat" });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.hbTimer) {
      clearInterval(this.hbTimer);
      this.hbTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) {
      this.setStatus("closed");
      return;
    }
    this.setStatus("reconnecting");
    const delay = Math.min(15_000, 1000 * 2 ** this.attempt);
    this.attempt += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.shouldReconnect) this.open();
    }, delay);
  }

  private cleanupWs(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        // 忽略
      }
      this.ws = null;
    }
  }

  private setStatus(s: ConnStatus): void {
    if (this.status === s) return; // 去重：避免 displaced 消息与 close 码双触发
    this.status = s;
    this.onStatusChange(s);
  }
}
