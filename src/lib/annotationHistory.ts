import type { Annotation } from "../types";

export type AnnotationHistoryEntry =
  | { kind: "add"; annotation: Annotation }
  | { kind: "delete"; annotation: Annotation };

export class AnnotationHistory {
  private undo: AnnotationHistoryEntry[] = [];
  private redo: AnnotationHistoryEntry[] = [];

  push(entry: AnnotationHistoryEntry) {
    this.undo.push(entry);
    if (this.undo.length > 50) this.undo.shift();
    this.redo = [];
  }

  canUndo() {
    return this.undo.length > 0;
  }

  canRedo() {
    return this.redo.length > 0;
  }

  popUndo(): AnnotationHistoryEntry | undefined {
    const entry = this.undo.pop();
    if (entry) this.redo.push(entry);
    return entry;
  }

  popRedo(): AnnotationHistoryEntry | undefined {
    const entry = this.redo.pop();
    if (entry) this.undo.push(entry);
    return entry;
  }
}
