import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RoundProvider } from "@/lib/store";

import Accuracy from "./pages/Accuracy";
import Alerts from "./pages/Alerts";
import Bankroll from "./pages/Bankroll";
import Charts from "./pages/Charts";
import Dashboard from "./pages/Dashboard";
import Data from "./pages/Data";
import Ingest from "./pages/Ingest";
import Docs from "./pages/Docs";
import EngineView from "./pages/EngineView";
import Ev from "./pages/Ev";
import Exceedance from "./pages/Exceedance";
import Fairness from "./pages/Fairness";
import Feed from "./pages/Feed";
import Phases from "./pages/Phases";
import NotFound from "./pages/NotFound";
import Randomness from "./pages/Randomness";
import Responsible from "./pages/Responsible";
import Settings from "./pages/Settings";
import Skill from "./pages/Skill";
import Strategy from "./pages/Strategy";
import Windows from "./pages/Windows";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 15_000 } },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <RoundProvider>
        <HashRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/feed" element={<Feed />} />
              <Route path="/charts" element={<Charts />} />
              <Route path="/windows" element={<Windows />} />
              <Route path="/predictor" element={<EngineView view="predictor" />} />
              <Route path="/studio" element={<EngineView view="studio" />} />
              <Route path="/radar" element={<EngineView view="radar" />} />
              <Route path="/pressure" element={<EngineView view="pressure" />} />
              <Route path="/autopilot" element={<EngineView view="autopilot" />} />
              <Route path="/dna" element={<EngineView view="dna" />} />
              <Route path="/ladders" element={<EngineView view="ladders" />} />
              <Route path="/analytics" element={<EngineView view="analytics" />} />
              <Route path="/accuracy" element={<Accuracy />} />
              <Route path="/exceedance" element={<Exceedance />} />
              <Route path="/skill" element={<Skill />} />
              <Route path="/phases" element={<Phases />} />
              <Route path="/randomness" element={<Randomness />} />
              <Route path="/fairness" element={<Fairness />} />
              <Route path="/ev" element={<Ev />} />
              <Route path="/strategy" element={<Strategy />} />
              <Route path="/bankroll" element={<Bankroll />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/ingest" element={<Ingest />} />
              <Route path="/data" element={<Data />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/responsible" element={<Responsible />} />
              <Route path="/index.html" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </HashRouter>
      </RoundProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
