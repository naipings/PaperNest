import { installDshModuleLoader } from "../research-harness/moduleLoader";
import { ResearchHarnessProvider } from "../research-harness/ResearchHarnessProvider";
import { ResearchView } from "./ResearchView";

installDshModuleLoader();

export function ResearchScreen() {
  return (
    <ResearchHarnessProvider>
      <ResearchView />
    </ResearchHarnessProvider>
  );
}
