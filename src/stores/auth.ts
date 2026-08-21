/**
 * 鉴权状态：登录、令牌持久化、登出。
 *
 * 账号可拥有多个角色（roles）。登录后 `roleHome()` 按优先级（ADMIN > 裁判 >
 * 导播 > 选手）进入默认端；各端顶栏的 RoleSwitcher 可切到其他角色对应的端。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api, ApiError } from "@/api/client";
import {
  AccountType,
  type LoginEndpoint,
  type LoginRequest,
  type TokenResponse,
} from "@/api/types";
import { t as tr } from "@/locales";

const STORAGE_KEY = "twc_auth";

/** 登录端 → 展示名词条（后端 403 ENDPOINT_FORBIDDEN 时本地化提示用） */
const ENDPOINT_LABEL_KEYS: Record<LoginEndpoint, string> = {
  admin: "role.admin",
  referee: "role.referee",
  director: "role.director",
  player: "role.player",
};

interface PersistedAuth {
  token: string;
  accountId: string;
  username: string;
  accountRoles: number[];
  displayName: string;
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref("");
  const accountId = ref("");
  const username = ref("");
  const accountRoles = ref<number[]>([]);
  const displayName = ref("");
  const loginError = ref("");

  function load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<PersistedAuth> & {
        accountType?: number;
      };
      token.value = p.token ?? "";
      accountId.value = p.accountId ?? "";
      username.value = p.username ?? "";
      accountRoles.value = Array.isArray(p.accountRoles)
        ? p.accountRoles
        : p.accountType != null
          ? [p.accountType]
          : [];
      displayName.value = p.displayName ?? "";
    } catch {
      // 损坏的本地存储，忽略
    }
  }

  function persist(): void {
    const p: PersistedAuth = {
      token: token.value,
      accountId: accountId.value,
      username: username.value,
      accountRoles: accountRoles.value,
      displayName: displayName.value,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  }

  function clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    token.value = "";
    accountId.value = "";
    username.value = "";
    accountRoles.value = [];
    displayName.value = "";
  }

  const isLoggedIn = computed(() => !!token.value);
  /** 主角色（最高优先级），兼容旧的单 type 引用 */
  const accountType = computed<number>(() => {
    for (const t of [
      AccountType.ADMIN,
      AccountType.REFEREE,
      AccountType.DIRECTOR,
      AccountType.PLAYER,
    ]) {
      if (accountRoles.value.includes(t)) return t;
    }
    return 0;
  });

  function hasRole(role: AccountType): boolean {
    return accountRoles.value.includes(role);
  }

  const isReferee = computed(() => hasRole(AccountType.REFEREE));
  const isAdmin = computed(() => hasRole(AccountType.ADMIN));

  /** 按角色优先级返回默认首页路由。 */
  function roleHome(): string {
    if (hasRole(AccountType.ADMIN)) return "/admin/matches";
    if (hasRole(AccountType.REFEREE)) return "/referee";
    if (hasRole(AccountType.DIRECTOR)) return "/director";
    if (hasRole(AccountType.PLAYER)) return "/player";
    return "/pending";
  }

  async function login(req: LoginRequest): Promise<boolean> {
    loginError.value = "";
    try {
      const res: TokenResponse = await api.login(req);
      token.value = res.access_token;
      accountId.value = res.account_id;
      username.value = res.username;
      accountRoles.value = res.roles;
      displayName.value = res.display_name;
      persist();
      return true;
    } catch (e) {
      // 选了端但无对应角色：后端 403 ENDPOINT_FORBIDDEN，按端名本地化提示
      if (
        e instanceof ApiError &&
        e.errorCode === "ENDPOINT_FORBIDDEN" &&
        req.endpoint
      ) {
        loginError.value = tr("login.noPermission", {
          role: tr(ENDPOINT_LABEL_KEYS[req.endpoint]),
        });
      } else {
        loginError.value =
          e instanceof ApiError ? e.message : tr("login.failed");
      }
      return false;
    }
  }

  function logout(): void {
    clear();
  }

  /** 改名成功后同步本地 displayName 并持久化（由设置弹窗在 api 成功后调用） */
  function applyDisplayName(name: string): void {
    displayName.value = name;
    persist();
  }

  load();

  return {
    token,
    accountId,
    username,
    accountRoles,
    accountType,
    displayName,
    loginError,
    isLoggedIn,
    isReferee,
    isAdmin,
    hasRole,
    roleHome,
    login,
    logout,
    applyDisplayName,
  };
});
