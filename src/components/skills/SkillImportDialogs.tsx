import { useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Modal } from "../Modal";
import { backend } from "../../services/backend";
import type { GithubSkillScan, SkillEntry, SkillLocalScan } from "../../types";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Pickable = { key: string; label: string; detail: string; badges: string[]; disabled: boolean };

function PickList({ items, picked, onToggle }: { items: Pickable[]; picked: Set<string>; onToggle(key: string): void }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = needle ? items.filter(item => `${item.label} ${item.detail}`.toLowerCase().includes(needle)) : items;
  return <>
    <input placeholder="按名称或描述筛选" value={query} onChange={event => setQuery(event.target.value)} />
    <ul className="skill-pick-list">
      {visible.map(item => (
        <li key={item.key}>
          <label className={item.disabled ? "disabled" : ""}>
            <input type="checkbox" disabled={item.disabled} checked={picked.has(item.key)} onChange={() => onToggle(item.key)} />
            <span>
              <strong>{item.label}</strong>
              {item.badges.map(badge => <em key={badge}>{badge}</em>)}
              {item.detail && <small>{item.detail}</small>}
            </span>
          </label>
        </li>
      ))}
      {!visible.length && <li className="skill-pick-empty">没有匹配的 skill</li>}
    </ul>
  </>;
}

function useToggleSet() {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setPicked(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return [picked, toggle] as const;
}

export function SkillImportLocalDialog({ scan, onClose, onDone }: {
  scan: SkillLocalScan;
  onClose(): void;
  onDone(list: SkillEntry[], message: string): void;
}) {
  const [picked, toggle] = useToggleSet();
  const [repos, setRepos] = useState(scan.repos.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const items = scan.skills.map(skill => ({
    key: skill.dir,
    label: skill.name,
    detail: skill.error ?? skill.description,
    badges: [
      skill.installed ? "已在库中" : "",
      skill.error ? "无法导入" : "",
      skill.hasScripts ? "含脚本" : "",
      skill.requires.length ? `引用 ${skill.requires.join("、")}` : "",
    ].filter(Boolean),
    disabled: skill.installed || !!skill.error,
  }));
  const deps = useMemo(() => {
    const found = new Set<string>();
    for (const skill of scan.skills) {
      if (picked.has(skill.dir)) skill.requires.filter(dir => !picked.has(dir)).forEach(dir => found.add(dir));
    }
    return [...found].sort();
  }, [scan, picked]);

  const submit = async () => {
    setBusy(true);
    setError("");
    let added: string[];
    let list: SkillEntry[];
    try {
      const before = new Set((await backend.skillsList()).map(skill => skill.dir));
      list = await backend.skillsImportLocal(scan.root, [...picked]);
      added = list.filter(skill => !before.has(skill.dir)).map(skill => skill.dir);
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
      return;
    }
    const repoList = repos.split("\n").map(line => line.trim()).filter(Boolean);
    let message = `已导入 ${added.length} 项`;
    if (repoList.length) {
      try {
        const report = await backend.skillsLinkSources(repoList, added);
        list = await backend.skillsList();
        message += `；来源一致 ${report.linked.length}，与上游不同 ${report.differs.length}，未找到来源 ${report.unmatched.length}`;
        if (report.unmatched.length) message += `（${report.unmatched.join("、")}）`;
      } catch (e) {
        message += `；关联来源失败：${messageOf(e)}`;
      }
    }
    onDone(list, message);
  };

  return (
    <Modal title="从本地导入 Skill" wide onClose={onClose}>
      <div className="paper-editor skill-import">
        <p className="skill-import-note">来源目录：<code>{scan.root}</code> · 共 {scan.skills.length} 个 skill</p>
        <PickList items={items} picked={picked} onToggle={toggle} />
        {deps.length > 0 && <p className="skill-import-note">所选 skill 引用的同级目录将一并导入（库中已有的跳过）：{deps.join("、")}</p>}
        <label>
          导入后按以下 GitHub 仓库关联来源（每行一个 owner/repo；留空则不关联）
          <textarea rows={3} value={repos} onChange={event => setRepos(event.target.value)} />
        </label>
        {error && <p className="inline-notice">{error}</p>}
        <footer>
          <button type="button" className="ghost" onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={!picked.size || busy} onClick={() => void submit()}>
            {busy && <LoaderCircle className="spin" size={15} />}导入所选（{picked.size}）
          </button>
        </footer>
      </div>
    </Modal>
  );
}

export function SkillImportGithubDialog({ onClose, onDone }: {
  onClose(): void;
  onDone(list: SkillEntry[], message: string): void;
}) {
  const [source, setSource] = useState("");
  const [scan, setScan] = useState<GithubSkillScan>();
  const [picked, toggle] = useToggleSet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const items = (scan?.skills ?? []).map(skill => ({
    key: skill.path,
    label: skill.dir,
    detail: skill.path || "（仓库根目录）",
    badges: [skill.installed ? "已在库中" : "", skill.hasScripts ? "含脚本" : ""].filter(Boolean),
    disabled: skill.installed,
  }));

  const submit = () => run(async () => {
    const before = new Set((await backend.skillsList()).map(skill => skill.dir));
    const list = await backend.skillsImportGithub(scan!.repo, [...picked]);
    const added = list.filter(skill => !before.has(skill.dir)).length;
    onDone(list, `已从 ${scan!.repo} 导入 ${added} 项（含引用的同级目录）`);
  });

  return (
    <Modal title="从 GitHub 导入 Skill" wide onClose={onClose}>
      <div className="paper-editor skill-import">
        <div className="skill-repo-row">
          <input
            placeholder="owner/repo 或仓库地址，例如 Yuan1z0825/nature-skills"
            value={source}
            onChange={event => setSource(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && source.trim()) void run(async () => setScan(await backend.skillsScanGithub(source))); }}
          />
          <button type="button" className="secondary" disabled={!source.trim() || busy} onClick={() => void run(async () => setScan(await backend.skillsScanGithub(source)))}>
            读取仓库
          </button>
        </div>
        {scan && <>
          <p className="skill-import-note">{scan.repo} · 共 {scan.skills.length} 个 skill（含 SKILL.md 的目录）</p>
          <PickList items={items} picked={picked} onToggle={toggle} />
        </>}
        {error && <p className="inline-notice">{error}</p>}
        <footer>
          <button type="button" className="ghost" onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={!scan || !picked.size || busy} onClick={() => void submit()}>
            {busy && <LoaderCircle className="spin" size={15} />}导入所选（{picked.size}）
          </button>
        </footer>
      </div>
    </Modal>
  );
}
