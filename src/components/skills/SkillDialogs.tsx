import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Modal } from "../Modal";
import { backend } from "../../services/backend";
import type { SkillDiffEntry, SkillEntry } from "../../types";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function SkillUpdateDialog({ dirs, onClose, onDone }: {
  dirs: string[];
  onClose(): void;
  onDone(list: SkillEntry[], message: string): void;
}) {
  const [diffs, setDiffs] = useState<SkillDiffEntry[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void backend.skillsDiff(dirs).then(setDiffs).catch(e => setError(messageOf(e)));
  }, [dirs]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const list = await backend.skillsUpdate(dirs);
      onDone(list, `已更新 ${dirs.length} 项，旧版本已移到 skills/.backup/`);
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="更新 Skill" wide onClose={onClose}>
      <div className="paper-editor">
        {!diffs && !error && <p className="skill-import-note"><LoaderCircle className="spin" size={14} />正在对比本地与 GitHub 上游…</p>}
        {diffs?.map(diff => (
          <section className="skill-diff" key={diff.dir}>
            <h4>{diff.dir}<small>新增 {diff.added.length} · 删除 {diff.removed.length} · 修改 {diff.modified.length}</small></h4>
            <ul>
              {diff.added.map(path => <li key={`a-${path}`} className="added">+ {path}</li>)}
              {diff.removed.map(path => <li key={`r-${path}`} className="removed">− {path}</li>)}
              {diff.modified.map(path => <li key={`m-${path}`} className="modified">~ {path}</li>)}
            </ul>
          </section>
        ))}
        {diffs && <p className="skill-import-note">确认后用 GitHub 上游版本覆盖本地目录；当前版本整体移到 skills/.backup/&lt;目录名&gt;-&lt;时间&gt;/。</p>}
        {error && <p className="inline-notice">{error}</p>}
        <footer>
          <button type="button" className="ghost" onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={!diffs || busy} onClick={() => void submit()}>
            {busy && <LoaderCircle className="spin" size={15} />}备份并更新
          </button>
        </footer>
      </div>
    </Modal>
  );
}

export function SkillLinkDialog({ skill, onClose, onDone }: {
  skill: SkillEntry;
  onClose(): void;
  onDone(list: SkillEntry[], message: string): void;
}) {
  const [repo, setRepo] = useState(skill.sourceRepo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const report = await backend.skillsLinkSources([repo], [skill.dir]);
      if (report.unmatched.length) {
        setError(`仓库中没有名为 ${skill.dir} 的目录`);
        setBusy(false);
        return;
      }
      const list = await backend.skillsList();
      onDone(list, report.linked.length ? `${skill.name} 已关联，内容与上游一致` : `${skill.name} 已关联，本地内容与上游不同，可「查看差异并更新」`);
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={`关联来源：${skill.name}`} onClose={onClose}>
      <div className="paper-editor">
        <label>
          GitHub 仓库（按目录名 {skill.dir} 在仓库中查找）
          <input placeholder="owner/repo 或仓库地址" value={repo} onChange={event => setRepo(event.target.value)} />
        </label>
        {error && <p className="inline-notice">{error}</p>}
        <footer>
          <button type="button" className="ghost" onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={!repo.trim() || busy} onClick={() => void submit()}>
            {busy && <LoaderCircle className="spin" size={15} />}关联
          </button>
        </footer>
      </div>
    </Modal>
  );
}

export function SkillTokenDialog({ saved, onClose, onDone }: {
  saved: boolean;
  onClose(): void;
  onDone(saved: boolean): void;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  const save = async (value: string) => {
    try {
      onDone(await backend.skillsSaveGithubToken(value));
    } catch (e) {
      setError(messageOf(e));
    }
  };

  return (
    <Modal title="GitHub Token" onClose={onClose}>
      <div className="paper-editor">
        <p className="skill-import-note">
          未认证的 GitHub API 每小时限 60 次请求；保存 Token 后上限为 5000 次。只需公开仓库读取权限，Token 保存在系统凭据管理器。
          {saved ? "当前已保存 Token。" : "当前未保存 Token。"}
        </p>
        <label>
          Token
          <input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} />
        </label>
        {error && <p className="inline-notice">{error}</p>}
        <footer>
          {saved && <button type="button" className="secondary" onClick={() => void save("")}>清除已保存</button>}
          <button type="button" className="ghost" onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={!token.trim()} onClick={() => void save(token)}>保存</button>
        </footer>
      </div>
    </Modal>
  );
}
