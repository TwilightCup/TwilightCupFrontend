/**
 * WebSocket 封装：鉴权连接、心跳保活、断线自动重连。
 *
 * - 连接端点 ws://.../ws/{token}，token 为登录返回的 JWT。
 * - 鉴权失败（auth_error）为终态，停止重连。
 * - 意外断开按指数退避重连（1s → 2s → 4s … 上限 15s）。
 */
import { wsUrl } from "@/api/config";
import type { ClientMessage, ServerMessage } from "./protocol";

export type ConnStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

const HEARTBEAT_MS = 25_000;

export class MatchSocket {
  /** 由外部（store）注入的回调 */
  onMessage: (msg: ServerMessage) => void = () => {};
  onStatusChange: (status: ConnStatus) => void = () => {};

  status: ConnStatus = "idle";
  private ws: WebSocket | null = null;
  private token = "";
  private seat: string | undefined;
  private session: string | undefined;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private attempt = 0;

  connect(token: string, seat?: string, session?: string): void {
    this.token = token;
    this.seat = seat;
    this.session = session;
    this.shouldReconnect = true;
    this.attempt = 0;
    this.open();
  }

  private open(): void {
    this.cleanupWs();
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(this.token, this.seat, this.session));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus("open");
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
      // 鉴权失败为终态，停止重连
      if (msg.type === "auth_error") {
        this.shouldReconnect = false;
      }
      this.onMessage(msg);
    };

    ws.onerror = () => {
      // 错误细节由 onclose 统一处理（重连/状态切换）
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      this.ws = null;
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      } else {
        this.setStatus("closed");
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

  /** 主动断开，不再重连 */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
    this.status = s;
    this.onStatusChange(s);
  }
}
