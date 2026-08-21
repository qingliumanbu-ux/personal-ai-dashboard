import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/noto-sans-sc/chinese-simplified-400.css";
import "@fontsource/noto-sans-sc/chinese-simplified-500.css";
import "@fontsource/noto-sans-sc/chinese-simplified-600.css";
import "@fontsource/noto-serif-sc/chinese-simplified-600.css";
import "@fontsource/noto-serif-sc/chinese-simplified-700.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { App } from "./App.jsx";
import "./styles.css";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/overview.css";
import "./styles/focus-workspace.css";
import "./styles/daily-review.css";
import "./styles/tomorrow-suggestions.css";
import "./styles/work-rules.css";
import "./styles/command.css";
import "./styles/effects.css";
import "./styles/knowledge-core.css";
import "./styles/workspace.css";
import "./styles/color-system-v6.css";
import "./styles/design-lab-tokens.css";
import "./styles/design-lab.css";
import "./styles/design-lab-workspace.css";
import "./styles/design-lab-graph-semantic.css";
import "./styles/design-lab-graph-network.css";
import "./styles/v7-formal.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
