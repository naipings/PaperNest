import { useCallback, useEffect, useState } from "react";
import { CloudDownload, FolderOpen, FolderPlus, Github, KeyRound, Link2, LoaderCircle, Puzzle, RefreshCw, Trash2 } from "lucide-react";
import { backend, isTauri } from "../services/backend";
import { DeepReadMarkdown } from "./deepread/DeepReadMarkdown";
import { SkillImportGithubDialog, SkillImportLocalDialog } from "./skills/SkillImportDialogs";
import { SkillLinkDialog, SkillTokenDialog, SkillUpdateDialog } from "./skills/SkillDialogs";
import type { SkillEntry, SkillLocalScan, SkillStatus } from "../types";

const STATUS_LABEL: Record<SkillStatus, string> = {
  unlinked: "未关联来源",
  unchecked: "未检查",
  current: "已是最新",
  outdated: "有更新",
  differs: "与上游不同",
  missing: "上游已删除",
};

const STATUS_CLASS: Record<SkillStatus, string> = {
  unlinked: "status-draft",
  unchecked: "status-draft",
  current: "status-completed",
  outdated: "status-running",
  differs: "status-running",
  missing: "status-failed",
};

type Dialog =
  | { kind: "local"; scan: SkillLocalScan }
  | { kind: "github" }
  | { kind: "update"; dirs: string[] }
  | { kind: "link"; skill: SkillEntry }
  | { kind: "token" };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const updatable = (skill: SkillEntry) => skill.status === "outdated" || skill.status === "differs";
const stripFrontmatter = (text: string) => text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[^\n]*\n/, "");

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function SkillLibraryView() {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [selectedDir, setSelectedDir] = useState<string>();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [skillMd, setSkillMd] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog>();
  const [tokenSaved, setTokenSaved] = useState(false);

  const showError = useCallback((error: unknown) => setNotice(messageOf(error)), []);

  useEffect(() => {
    if (!isTauri()) return;
    void backend.skillsList().then(list => {
      setSkills(list);
      setSelectedDir(list[0]?.dir);
    }).catch(showError);
    void backend.skillsGithubTokenSaved().then(setTokenSaved).catch(showError);
  }, [showError]);

  const selected = skills.find(skill => skill.dir === selectedDir);

  useEffect(() => {
    setSkillMd("");
    if (!selected || selected.kind !== "skill") return;
    void backend.skillsReadSkillMd(selected.dir).then(setSkillMd).catch(showError);
  }, [selected?.dir, selected?.kind, selected?.updatedAt, showError]);

  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(label);
    setNotice("");
    try {
      setNotice(await action());
    } catch (error) {
      showError(error);
    } finally {
      setBusy("");
    }
  };

  const finishDialog = (list: SkillEntry[], message: string) => {
    setSkills(list);
    setSelectedDir(current => current ?? list[0]?.dir);
    setDialog(undefined);
    setNotice(message);
  };

  const importLocal = async () => {
    const root = await backend.skillsChooseFolder();
    if (!root) return;
    await run("正在扫描目录…", async () => {
      setDialog({ kind: "local", scan: await backend.skillsScanLocal(root) });
      return "";
    });
  };

  const checkUpdates = (dirs: string[] | null) => run("正在检查 GitHub 上游…", async () => {
    const list = await backend.skillsCheckUpdates(dirs);
    setSkills(list);
    const scope = dirs ? list.filter(skill => dirs.includes(skill.dir)) : list;
    const pending = scope.filter(updatable).length;
    const missing = scope.filter(skill => skill.status === "missing").length;
    return [pending ? `${pending} 项可更新` : "已是最新", missing ? `${missing} 项上游已删除` : ""].filter(Boolean).join("；");
  });

  const remove = async (dirs: string[]) => {
    const names = skills.filter(skill => dirs.includes(skill.dir)).map(skill => skill.name);
    const dependents = skills.filter(skill => !dirs.includes(skill.dir) && skill.requires.some(dir => dirs.includes(dir))).map(skill => skill.name);
    const warning = dependents.length ? `\n以下 skill 引用了它们：${dependents.join("、")}` : "";
    if (!confirm(`删除 ${names.join("、")}？目录与记录将一并删除。${warning}`)) return;
    await run("正在删除…", async () => {
      setSkills(await backend.skillsDelete(dirs));
      setChecked(new Set());
      if (selectedDir && dirs.includes(selectedDir)) setSelectedDir(undefined);
      return `已删除 ${dirs.length} 项`;
    });
  };

  const setEnabled = (skill: SkillEntry, enabled: boolean) =>
    void backend.skillsSetEnabled(skill.dir, enabled).then(setSkills).catch(showError);

  const toggleChecked = (dir: string) => setChecked(current => {
    const next = new Set(current);
    if (next.has(dir)) next.delete(dir);
    else next.add(dir);
    return next;
  });

  if (!isTauri()) {
    return (
      <main className="content-page research-page skills-page">
        <header className="page-heading"><h1>Skill 库</h1><p>请在桌面端使用此功能。</p></header>
      </main>
    );
  }

  const pending = skills.filter(updatable);
  const groups = [
    { title: "Skill", items: skills.filter(skill => skill.kind === "skill") },
    { title: "共享目录", items: skills.filter(skill => skill.kind === "shared") },
  ].filter(group => group.items.length);
  const requiredBy = selected ? skills.filter(skill => skill.requires.includes(selected.dir)).map(skill => skill.name) : [];

  return (
    <main className="content-page research-page skills-page research-workspace">
      <div className="research-layout">
        <header className="research-page-header research-page-header-left page-heading">
          <div className="page-title-block">
            <div className="page-title-row">
              <span className="page-title-icon"><Puzzle size={18} /></span>
              <h1>Skill 库</h1>
            </div>
            <p>管理精读追问时可用的 Skill。支持本地目录和 GitHub 导入，脚本不会执行。</p>
          </div>
        </header>
        <div className="research-page-header research-page-header-right page-heading-actions">
          {notice && <span className="inline-notice research-inline-notice">{notice}</span>}
          {busy && <span className="inline-notice research-inline-notice"><LoaderCircle className="spin" size={14} />{busy}</span>}
          <button type="button" className="secondary" disabled={!!busy} onClick={() => void importLocal()}><FolderPlus size={16} />从本地导入</button>
          <button type="button" className="secondary" disabled={!!busy} onClick={() => setDialog({ kind: "github" })}><Github size={16} />从 GitHub 导入</button>
          <button type="button" className="secondary" disabled={!!busy || !skills.some(skill => skill.sourceRepo)} onClick={() => void checkUpdates(null)}><RefreshCw size={16} />检查全部更新</button>
          <button type="button" className="secondary" disabled={!!busy || !pending.length} onClick={() => setDialog({ kind: "update", dirs: pending.map(skill => skill.dir) })}><CloudDownload size={16} />全部更新（{pending.length}）</button>
          <button type="button" className="secondary" onClick={() => setDialog({ kind: "token" })}><KeyRound size={16} />GitHub Token{tokenSaved ? "（已保存）" : ""}</button>
          <button type="button" className="secondary" onClick={() => void backend.skillsOpenDir(null).catch(showError)}><FolderOpen size={16} />打开目录</button>
        </div>

        <aside className="research-sidebar">
          {groups.map(group => (
            <section className="research-history" key={group.title}>
              <h3>{group.title}（{group.items.length}）</h3>
              <ul className="research-session-list">
                {group.items.map(skill => (
                  <li key={skill.dir}>
                    <input type="checkbox" className="skill-check" aria-label={`选择 ${skill.name}`} checked={checked.has(skill.dir)} onChange={() => toggleChecked(skill.dir)} />
                    <button type="button" className={`research-session-item${selectedDir === skill.dir ? " active" : ""}`} onClick={() => setSelectedDir(skill.dir)}>
                      <span className="research-session-item-top">
                        <strong>{skill.name}</strong>
                        <span className={`research-session-status ${STATUS_CLASS[skill.status]}`}>{STATUS_LABEL[skill.status]}</span>
                      </span>
                      <small>
                        {[skill.sourceRepo ?? "本地导入", skill.hasScripts ? "含脚本" : "", skill.kind === "skill" && !skill.enabled ? "已停用" : ""].filter(Boolean).join(" · ")}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!skills.length && <p className="research-session-empty">Skill 库为空。点击「从本地导入」或「从 GitHub 导入」。</p>}
          {checked.size > 0 && (
            <button type="button" className="secondary" disabled={!!busy} onClick={() => void remove([...checked])}><Trash2 size={16} />删除所选（{checked.size}）</button>
          )}
        </aside>

        <section className="research-main skills-main">
          {selected ? (
            <>
              <header className="research-detail-header">
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.kind === "skill" ? "Skill" : "共享目录"} · skills/{selected.dir}{selected.license ? ` · ${selected.license}` : ""}</p>
                </div>
                <div className="research-detail-actions">
                  {selected.kind === "skill" && (
                    <label className="skill-toggle">
                      <input type="checkbox" checked={selected.enabled} onChange={event => setEnabled(selected, event.target.checked)} />
                      追问时启用
                    </label>
                  )}
                  {selected.sourceRepo && <>
                    <button type="button" className="secondary" disabled={!!busy} onClick={() => void checkUpdates([selected.dir])}><RefreshCw size={16} />检查更新</button>
                    <button type="button" className="secondary" disabled={!!busy || !updatable(selected)} onClick={() => setDialog({ kind: "update", dirs: [selected.dir] })}><CloudDownload size={16} />查看差异并更新</button>
                  </>}
                  <button type="button" className="secondary" disabled={!!busy} onClick={() => setDialog({ kind: "link", skill: selected })}><Link2 size={16} />{selected.sourceRepo ? "更改来源" : "关联来源"}</button>
                  <button type="button" className="secondary" onClick={() => void backend.skillsOpenDir(selected.dir).catch(showError)}><FolderOpen size={16} />打开目录</button>
                  <button type="button" className="secondary" disabled={!!busy} onClick={() => void remove([selected.dir])}><Trash2 size={16} />删除</button>
                </div>
              </header>
              <div key={selected.dir} className="skill-content" tabIndex={0} role="region" aria-label="Skill 详情">
              <dl className="skill-detail-grid">
                {selected.description && <><dt>描述</dt><dd>{selected.description}</dd></>}
                <dt>来源</dt>
                <dd>
                  {selected.sourceRepo ? (
                    <a href="#" onClick={event => {
                      event.preventDefault();
                      void backend.openExternalUrl(`https://github.com/${selected.sourceRepo}/tree/HEAD/${selected.sourcePath ?? ""}`);
                    }}>{selected.sourceRepo}{selected.sourcePath ? ` / ${selected.sourcePath}` : ""}</a>
                  ) : "本地导入，未关联 GitHub 仓库"}
                </dd>
                <dt>状态</dt>
                <dd>{STATUS_LABEL[selected.status]}{selected.checkedAt ? `（检查于 ${formatTime(selected.checkedAt)}）` : ""}</dd>
                {selected.requires.length > 0 && <><dt>引用</dt><dd>{selected.requires.map(dir => skills.some(skill => skill.dir === dir) ? dir : `${dir}（未导入）`).join("、")}</dd></>}
                {requiredBy.length > 0 && <><dt>被引用</dt><dd>{requiredBy.join("、")}</dd></>}
                {selected.hasScripts && <><dt>脚本</dt><dd>含脚本文件，PaperNest 不执行；追问时模型只读取文字说明。</dd></>}
                <dt>导入</dt>
                <dd>{formatTime(selected.installedAt)}{selected.updatedAt !== selected.installedAt ? `，更新于 ${formatTime(selected.updatedAt)}` : ""}</dd>
              </dl>
              {skillMd && <article className="skill-md" aria-label="Skill 文档"><DeepReadMarkdown text={stripFrontmatter(skillMd)} /></article>}
              </div>
            </>
          ) : (
            <div className="research-empty"><p>在左侧选择一个 skill 查看详情。</p></div>
          )}
        </section>
      </div>

      {dialog?.kind === "local" && <SkillImportLocalDialog scan={dialog.scan} onClose={() => setDialog(undefined)} onDone={finishDialog} />}
      {dialog?.kind === "github" && <SkillImportGithubDialog onClose={() => setDialog(undefined)} onDone={finishDialog} />}
      {dialog?.kind === "update" && <SkillUpdateDialog dirs={dialog.dirs} onClose={() => setDialog(undefined)} onDone={finishDialog} />}
      {dialog?.kind === "link" && <SkillLinkDialog skill={dialog.skill} onClose={() => setDialog(undefined)} onDone={finishDialog} />}
      {dialog?.kind === "token" && <SkillTokenDialog saved={tokenSaved} onClose={() => setDialog(undefined)} onDone={saved => {
        setTokenSaved(saved);
        setDialog(undefined);
        setNotice(saved ? "GitHub Token 已保存" : "GitHub Token 已清除");
      }} />}
    </main>
  );
}
