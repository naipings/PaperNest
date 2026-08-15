import { useState, type FormEvent } from "react";
import { Modal } from "./Modal";

const NEW_ID = "__new__";

export function PurposePickerDialog({
  options,
  initial = "待分类",
  onCancel,
  onConfirm
}: {
  options: string[];
  initial?: string;
  onCancel(): void;
  onConfirm(purpose: string): void;
}) {
  const [mode, setMode] = useState(options.includes(initial) ? initial : NEW_ID);
  const [custom, setCustom] = useState(options.includes(initial) ? "" : initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const purpose = (mode === NEW_ID ? custom : mode).trim();
    if (!purpose) return;
    onConfirm(purpose);
  };
  return <Modal title="写作用途" onClose={onCancel}>
    <form className="paper-editor" onSubmit={submit}>
      <label>归类到已有类别
        <select value={mode === NEW_ID ? NEW_ID : mode} onChange={e => setMode(e.target.value)}>
          {options.map(option => <option key={option} value={option}>{option}</option>)}
          <option value={NEW_ID}>新增类别…</option>
        </select>
      </label>
      {mode === NEW_ID && <label>新类别名称<input autoFocus value={custom} onChange={e => setCustom(e.target.value)} placeholder="例如：贡献陈述" required /></label>}
      {mode !== NEW_ID && <p className="muted" style={{ margin: 0 }}>也可在上方选择「新增类别…」自行命名。</p>}
      <footer>
        <button type="button" className="secondary" onClick={onCancel}>取消</button>
        <button className="primary" disabled={mode === NEW_ID && !custom.trim()}>确定</button>
      </footer>
    </form>
  </Modal>;
}
