<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useUiStore } from "../stores/ui";
import { usePacksStore } from "../stores/packs";
import { useSettingsStore } from "../stores/settings";
import type { WordPack } from "../shared/types";

const ui = useUiStore();
const packs = usePacksStore();
const settings = useSettingsStore();

const recentPacks = computed(() => packs.packs.slice(0, 4));

async function quickStart(): Promise<void> {
  if (!packs.packs.length) {
    ui.toast("还没有词包，请先创建词包", "warn");
    ui.go("packs");
    return;
  }
  // 有词包 → 直接进入游戏中心（优先最近使用的）
  const lastId = localStorage.getItem("sw:lastPackId") || packs.packs[0].id;
  const pack = packs.packs.find((p) => p.id === lastId) || packs.packs[0];
  ui.go("game-center", { packId: pack.id });
}

function openPack(p: WordPack): void {
  localStorage.setItem("sw:lastPackId", p.id);
  ui.go("game-center", { packId: p.id });
}

function lastUsed(p: WordPack): string {
  const d = new Date(p.updatedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

onMounted(() => packs.loadPacks());
</script>

<template>
  <div class="home">
    <div class="page-title">欢迎回来，老师 👋</div>
    <div class="page-sub">今天想上什么课？一条路径直达课堂。</div>

    <!-- 主行动区：开始课堂 -->
    <div class="hero card" @click="quickStart">
      <div class="hero-inner">
        <div class="hero-text">
          <h2 class="hero-title">🎬 开始课堂</h2>
          <p class="muted">选择最近词包 → 选玩法 → 全屏上课</p>
          <div class="row" style="margin-top: 16px; gap: 8px">
            <kbd>Space</kbd><span class="faint">揭晓</span>
            <kbd>→</kbd><span class="faint">下一题</span>
            <kbd>Esc</kbd><span class="faint">退出</span>
          </div>
        </div>
        <button class="btn btn-primary btn-xl">立即开始 →</button>
      </div>
    </div>

    <div class="grid grid-2 quick-actions">
      <button class="card action-card" @click="ui.go('smart-create')">
        <span class="action-emoji">✨</span>
        <div><div class="action-title">智能创建词包</div><div class="faint">粘贴内容 → 自动补全 → 保存</div></div>
      </button>
      <button class="card action-card" @click="ui.go('packs')">
        <span class="action-emoji">📚</span>
        <div><div class="action-title">我的词包</div><div class="faint">管理 {{ packs.packs.length }} 个词包</div></div>
      </button>
    </div>

    <!-- 最近词包 -->
    <div class="section-title">最近使用</div>
    <div v-if="recentPacks.length" class="grid grid-2">
      <button
        v-for="p in recentPacks"
        :key="p.id"
        class="card pack-card"
        @click="openPack(p)"
      >
        <div class="grow">
          <div class="text-lg">{{ p.name }}</div>
          <div class="faint" style="margin-top: 4px">{{ p.itemCount }} 个词条 · 最近 {{ lastUsed(p) }}</div>
        </div>
        <span class="go-btn">开始 →</span>
      </button>
    </div>
    <div v-else class="empty">
      <div class="big">📚</div>
      <div>还没有词包</div>
      <div class="faint" style="margin-top: 8px">点「智能创建」或「我的词包」开始</div>
    </div>

    <!-- 服务状态提示 -->
    <div class="card status-card">
      <div class="row space-between">
        <div class="row">
          <span style="font-size: 22px">{{ settings.isAiAvailable() ? "🟢" : "🟠" }}</span>
          <div>
            <div>{{ settings.isAiAvailable() ? "智能服务可用" : "智能服务未配置" }}</div>
            <div class="faint" style="font-size: 13px">
              {{ settings.isAiAvailable()
                ? `文本模型 ${settings.aiConfig.textModel} · 图片模型 ${settings.aiConfig.imageModel}`
                : "未配置时仍可离线教学：词典音标来自内置 IPA 词表" }}
            </div>
          </div>
        </div>
        <button class="btn btn-sm" @click="ui.go('settings')">去配置 →</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home { max-width: 1080px; margin: 0 auto; }
.hero {
  background: linear-gradient(135deg, #1e3a5f, #10283f);
  border-color: #2c5a8a;
  cursor: pointer;
  margin-bottom: 16px;
}
.hero-inner { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.hero-title { font-size: 30px; margin-bottom: 8px; }
.quick-actions { margin-bottom: 8px; }
.action-card {
  display: flex; align-items: center; gap: 16px; text-align: left;
  min-height: 96px; cursor: pointer; transition: border-color 0.15s;
}
.action-card:hover { border-color: var(--primary); }
.action-emoji { font-size: 34px; }
.action-title { font-weight: 700; font-size: 17px; margin-bottom: 4px; }
.pack-card {
  display: flex; align-items: center; gap: 12px; min-height: 76px; cursor: pointer;
  text-align: left;
}
.pack-card:hover { border-color: var(--primary); }
.go-btn { color: var(--primary); font-weight: 700; font-size: 15px; }
.status-card { margin-top: 16px; }
</style>
