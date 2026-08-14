import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LibraryProvider } from "./state/LibraryContext";
import "./styles.css";
import "./llm.css";

createRoot(document.getElementById("root")!).render(<StrictMode><LibraryProvider><App /></LibraryProvider></StrictMode>);
