import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LibraryProvider } from "./state/LibraryContext";
import "./styles.css";
import "./llm.css";
import "./reference-theme.css";
import "./lilac-dashboard-theme.css";
import "./mist-dashboard-theme.css";
import "./willow-dashboard-theme.css";

createRoot(document.getElementById("root")!).render(<StrictMode><LibraryProvider><App /></LibraryProvider></StrictMode>);
