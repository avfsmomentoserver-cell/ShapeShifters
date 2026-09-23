/**
 * Wrapper for the pattern engines. Each one keeps its original implementation and
 * gains a page frame plus an honest statement of what it can and cannot tell you.
 */
import { CurveShapes, DryZones, Regimes, Streaks } from "@/components/Analytics";
import { Autopilot } from "@/components/Autopilot";
import { DnaHunter } from "@/components/DnaHunter";
import { ForecastStudio } from "@/components/ForecastStudio";
import { LadderDash } from "@/components/LadderDash";
import { MegaPressureTracker } from "@/components/MegaPressureTracker";
import { MoonshotRadar } from "@/components/MoonshotRadar";
import { PredictorCard } from "@/components/PredictorCard";
import { PageHeader, Panel, Skeleton, Source } from "@/components/kit";
import { useRounds } from "@/lib/store";

export type EngineId =
  | "predictor"
  | "studio"
  | "radar"
  | "pressure"
  | "autopilot"
  | "dna"
  | "ladders"
  | "analytics";

const META: Record<EngineId, { title: string; kicker: string; reads: string; cannot: string }> = {
  predictor: {
    title: "Predictor",
    kicker: "ensemble candidate ranking",
    reads:
      "Blends the Markov state matrix, ladder pressure and DNA analogue vote into a ranked band, then prices each band from the observed tape.",
    cannot:
      "The calibrated probability comes from the distribution, not from the pattern signal. When the signal and the calibrated price disagree, the gap is the engine's overconfidence — the Accuracy page tracks it round by round.",
  },
  studio: {
    title: "Forecast Studio",
    kicker: "manual scenario construction",
    reads: "Lets you set a target and inspect survival, ETA and hazard for that specific cash-out.",
    cannot:
      "Changing the cash-out target changes the shape of the outcome, never the expected value: P(win) × payout stays at 1 − house edge for every target.",
  },
  radar: {
    title: "Moon Radar",
    kicker: "tail-event scanning",
    reads: "Tracks how long it has been since a 10× or higher, and how the tail index has drifted.",
    cannot:
      "A long gap since the last moonshot does not make one more likely. Each round draws fresh — the dry streak is a description of the past.",
  },
  pressure: {
    title: "Mega Pressure",
    kicker: "compression and release",
    reads: "Measures compression: runs of low multipliers, ceiling proximity and volatility contraction.",
    cannot:
      "Pressure is a summary statistic of previous rounds. On the tests in the Randomness Lab, no lagged relationship between pressure and the next multiplier survives.",
  },
  autopilot: {
    title: "Autopilot",
    kicker: "rules-driven staking simulator",
    reads: "Runs a rule set over the tape so you can see the equity curve a strategy would actually have produced.",
    cannot:
      "Autopilot is a simulator for paper play. It will never show a durable profit on a fair tape, and the Strategy Lab quantifies exactly how far below zero it lands.",
  },
  dna: {
    title: "DNA Hunter",
    kicker: "analogue tape matching",
    reads: "Finds the closest historical windows to the current sequence and reports what happened next in each of them.",
    cannot:
      "Nearest-neighbour matching on an independent series always finds close analogues — the number of candidate windows grows with the corpus while the information stays at zero.",
  },
  ladders: {
    title: "Ladders",
    kicker: "monotone run structure",
    reads: "Detects ascending and collapsing runs, plus the ceilings the tape keeps rejecting from.",
    cannot:
      "Runs of any length occur in random data at predictable rates. The runs test on the Randomness Lab page checks whether this tape has more of them than chance allows.",
  },
  analytics: {
    title: "Analytics",
    kicker: "distribution, regimes, streaks, dry zones",
    reads: "The descriptive layer: curve-shape mix, volatility regimes, streak lengths and dry-zone depth.",
    cannot:
      "Description is the honest use of this data. Interpreting a regime label as a forecast is where analytics turns into a betting system.",
  },
};

export default function EngineView({ view }: { view: EngineId }) {
  const { loading } = useRounds();
  const meta = META[view];

  return (
    <>
      <PageHeader title={meta.title} kicker={meta.kicker} />

      {loading ? (
        <Skeleton rows={6} />
      ) : (
        <div className="space-y-4">
          {view === "predictor" && <PredictorCard />}
          {view === "studio" && <ForecastStudio />}
          {view === "radar" && <MoonshotRadar />}
          {view === "pressure" && <MegaPressureTracker />}
          {view === "autopilot" && <Autopilot />}
          {view === "dna" && <DnaHunter />}
          {view === "ladders" && <LadderDash />}
          {view === "analytics" && (
            <div className="space-y-4">
              <CurveShapes />
              <Regimes />
              <Streaks />
              <DryZones />
            </div>
          )}

          <Panel title="what this engine actually measures">
            <dl className="space-y-3 text-xs leading-relaxed">
              <div>
                <dt className="stat-label">reads</dt>
                <dd className="mt-1 text-foreground">{meta.reads}</dd>
              </div>
              <div>
                <dt className="stat-label">cannot do</dt>
                <dd className="mt-1 text-muted-foreground">{meta.cannot}</dd>
              </div>
            </dl>
            <p className="mt-3 border-t border-border/60 pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
              Crash payout mathematics:{" "}
              <Source href="https://crashedge.com/guides/crash-gambling-maths/">CrashEdge, crash gambling maths</Source>.
              Aviator publishes a 97% RTP, i.e. a 3% house edge:{" "}
              <Source href="https://crashgamesplay.com/guides/aviator-review/">crashgamesplay.com review</Source>.
            </p>
          </Panel>
        </div>
      )}
    </>
  );
}
