import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { AccountType } from "@/api/types";
import { isTokenExpired } from "@/utils/jwt";

declare module "vue-router" {
  interface RouteMeta {
    requiresAuth?: boolean;
    /** 允许访问的账号类型；任一匹配路由声明了 roles 且当前角色不在其中则拦截 */
    roles?: AccountType[];
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/LoginView.vue"),
    },
    {
      path: "/referee",
      name: "referee-home",
      component: () => import("@/views/RefereeHomeView.vue"),
      meta: { requiresAuth: true, roles: [AccountType.REFEREE] },
    },
    {
      path: "/referee/:matchId",
      name: "referee-match",
      component: () => import("@/views/MatchView.vue"),
      meta: { requiresAuth: true, roles: [AccountType.REFEREE] },
    },
    {
      path: "/player",
      name: "player",
      component: () => import("@/views/PlayerView.vue"),
      meta: { requiresAuth: true, roles: [AccountType.PLAYER] },
    },
    {
      path: "/admin",
      component: () => import("@/views/admin/AdminLayout.vue"),
      meta: { requiresAuth: true, roles: [AccountType.ADMIN] },
      redirect: "/admin/matches",
      children: [
        {
          path: "matches",
          name: "admin-matches",
          component: () => import("@/views/admin/MatchesView.vue"),
        },
        {
          path: "tournaments",
          name: "admin-tournaments",
          component: () => import("@/views/admin/TournamentsView.vue"),
        },
        {
          path: "tournaments/:id",
          name: "admin-tournament-detail",
          component: () => import("@/views/admin/TournamentDetailView.vue"),
        },
        {
          path: "mappools",
          name: "admin-mappools",
          component: () => import("@/views/admin/MappoolsView.vue"),
        },
        {
          path: "levels",
          name: "admin-levels",
          component: () => import("@/views/admin/LevelsView.vue"),
        },
        {
          path: "accounts",
          name: "admin-accounts",
          component: () => import("@/views/admin/AccountsView.vue"),
        },
      ],
    },
    {
      path: "/pending",
      name: "pending",
      component: () => import("@/views/PendingView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/director",
      name: "director-home",
      component: () => import("@/views/DirectorHomeView.vue"),
      meta: { requiresAuth: true, roles: [AccountType.DIRECTOR] },
    },
    {
      path: "/director/:matchId",
      name: "director-match",
      component: () => import("@/views/DirectorView.vue"),
      meta: { requiresAuth: true, roles: [AccountType.DIRECTOR] },
    },
    {
      path: "/",
      name: "home",
      redirect: () => {
        const auth = useAuthStore();
        return auth.isLoggedIn ? auth.roleHome() : { name: "login" };
      },
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();

  // 本地令牌已过期（如隔夜重开标签页）视同未登录：清凭证后直接回登录页，
  // 避免先进页面再被一堆 401 打回来
  if (auth.isLoggedIn && isTokenExpired(auth.token)) {
    auth.logout();
    if (to.matched.some((r) => r.meta.requiresAuth)) {
      return { name: "login", query: { expired: "1" } };
    }
  }
  if (to.matched.some((r) => r.meta.requiresAuth) && !auth.isLoggedIn) {
    return { name: "login" };
  }
  if (to.name === "login" && auth.isLoggedIn) {
    return auth.roleHome();
  }
  // 角色守卫：匹配链上任一记录声明了 roles 且当前角色不在其中 → 回自己首页
  const blocked = to.matched.some((r) => {
    const roles = r.meta.roles;
    return (
      !!roles &&
      roles.length > 0 &&
      !roles.some((role) => auth.accountRoles.includes(role))
    );
  });
  if (auth.isLoggedIn && blocked) {
    return auth.roleHome();
  }
});

export default router;
