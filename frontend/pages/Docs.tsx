/**
 * Docs — the method, the formulas, the limits, and the sources. Written so that a
 * sceptical reader can check every claim the terminal makes.
 */
import { Link } from "react-router-dom";

import { Grid, PageHeader, Panel, Source } from "@/components/kit";
import { SourceDownloadButton } from "@/components/SourceDownload";

function Formula({ children }: { children: string }) {
  return (
    <code className="my-1 block overflow-x-auto rounded border border-border/70 bg-background/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-accent">
      {children}
    </code>
  );
}

export default function Docs() {
  return (
    <>
      <PageHeader title="Method" kicker="every formula, assumption and limit in one place">
        <SourceDownloadButton tone="accent" />
      </PageHeader>

      <div className="space-y-4">
        <Panel title="the short version">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Momento is an analytics terminal for crash games. It does two genuinely useful things: it verifies that
            individual rounds were dealt as committed, and it measures whether a tape behaves like independent fair draws.
            Everything else — pattern states, ladders, pressure, DNA matches, ETA — is descriptive statistics on past
            rounds. Those descriptions are real; their predictive value is not, and this terminal measures that claim rather
            than making it. If the{" "}
            <Link to="/randomness" className="text-accent underline underline-offset-2">
              randomness battery
            </Link>{" "}
            says the tape is consistent with independence, then by construction no engine here can beat the fair price, and
            the{" "}
            <Link to="/accuracy" className="text-accent underline underline-offset-2">
              accuracy ledger
            </Link>{" "}
            will show a Brier skill score at or below zero.
          </p>
        </Panel>

        <Grid cols={2}>
          <Panel title="crash game mathematics">
            <p className="text-xs leading-relaxed text-muted-foreground">
              With house edge h, the probability a round reaches multiplier m is
            </p>
            <Formula>P(reach m) = (1 − h) / m</Formula>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Cashing out at m pays m × stake, so expected value is
            </p>
            <Formula>EV = stake × [ m × (1 − h)/m − 1 ] = −h × stake</Formula>
            <p className="text-xs leading-relaxed text-muted-foreground">
              which is independent of the target. The median crash point is 2(1 − h) — 1.94× at a 3% edge — and expected
              loss over N rounds is N × stake × h. These identities are set out in{" "}
              <Source href="https://crashedge.com/guides/crash-gambling-maths/">CrashEdge's crash gambling maths guide</Source>
              . Consequences that surprise people: no cash-out target is better than any other in expectation; the only
              lever on cost is turnover; and any strategy comparison that does not report turnover is incomparable.
            </p>
          </Panel>

          <Panel title="provably fair verification">
            <p className="text-xs leading-relaxed text-muted-foreground">
              An operator commits to sha256(server seed) before play and reveals the seed afterwards. The crash point is
              derived deterministically:
            </p>
            <Formula>{`digest = HMAC_SHA256(server_seed, "client_seed:nonce")
i      = int(digest[:8], 16)
raw    = (2**32 / (i + 1)) * (1 − h)
crash  = floor(max(1, raw) * 100) / 100`}</Formula>
            <p className="text-xs leading-relaxed text-muted-foreground">
              documented by{" "}
              <Source href="https://provenlyfair.com/blog/verify-provably-fair-crash/">ProvenlyFair</Source>. Bustabit-style
              games instead take 52 bits of the hash and bust instantly when the value mod 101 is zero, which is where the
              ~1% edge comes from. Operators agree on the primitive but not on how the message is assembled, so the{" "}
              <Link to="/fairness" className="text-accent underline underline-offset-2">
                Fairness page
              </Link>{" "}
              exposes seven message templates and will brute-force the convention from a single known round rather than
              guessing.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              An honest caveat: a mismatch does not prove misconduct, because the convention may simply differ. The one
              unambiguous failure is a revealed seed that does not hash to the published commitment.
            </p>
          </Panel>
        </Grid>

        <Panel title="how probabilities are estimated">
          <p className="text-xs leading-relaxed text-muted-foreground">
            The original build fitted an exponential to the multipliers and read P(≥x) off the fit. That is wrong for a
            heavy-tailed distribution: it returned 0.94 for P(≥2×) where the fair value is 0.485 — nearly double. The
            replacement is a two-part estimator. Below the tail cut, the empirical survival function is used directly. In
            the tail, the Hill index is estimated from the top 15% of exceedances:
          </p>
          <Formula>{`alpha_hill = 1 / mean( ln(x_i / x_min) )   for the top k exceedances
S(x)       = S(x_min) * (x / x_min) ** (−alpha_hill)`}</Formula>
          <p className="text-xs leading-relaxed text-muted-foreground">
            A fair crash distribution has a tail index of exactly 1.0, so the fitted index doubles as a diagnostic: values
            far from 1.0 mean the tape is too short, mixed from different edges, or genuinely unusual. The index is clamped
            to 0.55–2.5 and at least eight exceedances are required before the tail model is used at all; otherwise the
            estimate falls back to the empirical value blended toward the fair price. Every published probability is then
            scored on the{" "}
            <Link to="/accuracy" className="text-accent underline underline-offset-2">
              accuracy page
            </Link>{" "}
            against forecasts locked before the round resolved.
          </p>
        </Panel>

        <Panel title="the randomness battery">
          <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
            Six independent tests, each answering a different way a tape could deviate from fair independent draws:
          </p>
          <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
            <li>
              <strong className="text-foreground">Chi-square goodness of fit</strong> — do band counts match (1 − h)/m?
              Catches a mis-set edge or a shaved payout band.
            </li>
            <li>
              <strong className="text-foreground">Kolmogorov-Smirnov</strong> — tests the whole distribution shape against
              1 − 1/m rather than binned counts.
            </li>
            <li>
              <strong className="text-foreground">Wald-Wolfowitz runs</strong> — is streak structure what independence
              produces? This is the test that answers "the game is due for a big one".
            </li>
            <li>
              <strong className="text-foreground">Ljung-Box autocorrelation</strong> — does any lag carry information about
              the next round? Every pattern engine implicitly assumes it does.
            </li>
            <li>
              <strong className="text-foreground">Conditional dependence</strong> — does the previous round's band change
              P(next ≥ 2×)? A direct test of the gambler's fallacy.
            </li>
            <li>
              <strong className="text-foreground">Digit uniformity</strong> — is the second decimal uniform? Rounding
              tricks and truncated randomness show here first.
            </li>
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Passing these tests does not prove a tape is fair — no finite test can. Failing one is more informative than
            passing all six, and the usual cause of a failure is a wrong house-edge setting or too small a sample rather
            than a rigged game.
          </p>
        </Panel>

        <Panel title="scoring rules used">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Brier score is the mean squared error of a probabilistic forecast; the skill score compares it against the
            benchmark of simply quoting the fair price:
          </p>
          <Formula>{`Brier = mean( (p_i − o_i)^2 )
skill = 1 − Brier_model / Brier_fair_price`}</Formula>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Positive skill means the engine knows something the fair price does not. Zero or negative means it does not,
            no matter how confident the interface looks. Log loss is reported alongside because it punishes confident
            wrong calls harder. The reliability diagram plots predicted against observed frequency: sitting on the diagonal
            proves calibration, which is honesty, not usefulness.
          </p>
        </Panel>

        <Panel title="seeding from a database">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Every figure in this app is computed from the loaded tape, so where the tape comes from matters more than any
            engine setting. A SQLite file can be ingested directly: it is opened read-only and immutable, every numeric
            column is scored on the share of values that are valid multipliers, how close the median sits to the fair
            1.94×, how heavy the tail is and whether the column is sorted — a sorted column is a counter, not a tape, which
            is the trap that makes an autoincrement id divided by a hundred look like plausible crash points. Integer
            storage is detected and converted, so 234 becomes 2.34×. Timestamps are parsed from ISO strings and from unix
            seconds, milliseconds and microseconds; an all-digit string is read as an epoch rather than a year.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            The preview step is not decoration. It extracts without writing and compares the observed exceedance rate at six
            thresholds against the fair curve for the configured house edge, so a stake column or a balance column is caught
            before it silently poisons every rate, drought, interval and expected-value number downstream. Keeping the
            original timestamps is what makes cadence measurable instead of assumed, which in turn is what lets window odds
            convert rounds into minutes and lets the hour-of-day test span more than one bucket.
          </p>
        </Panel>

        <Panel title="intervals, waits and window odds">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Every rate in the terminal now carries a 95%{" "}
            <Source href="https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval">
              Wilson score interval
            </Source>
            , which behaves sensibly at small counts and near 0 or 1 where the textbook normal interval does not:
          </p>
          <Formula>{`centre = (k + z²/2) / (n + z²)
half   = z/(n + z²) * sqrt( k(n−k)/n + z²/4 )`}</Formula>
          <p className="text-xs leading-relaxed text-muted-foreground">
            That interval is what turns three descriptive views into tests. The{" "}
            <Link to="/exceedance" className="text-accent underline underline-offset-2">
              exceedance grid
            </Link>{" "}
            asks whether the fair rate (1 − h)/x sits inside the interval at twelve thresholds; the{" "}
            <Link to="/phases" className="text-accent underline underline-offset-2">
              time-of-day page
            </Link>{" "}
            asks whether hourly rates differ by more than a chi-square test allows; the{" "}
            <Link to="/skill" className="text-accent underline underline-offset-2">
              skill ledger
            </Link>{" "}
            re-scores each ensemble component walk-forward, rebuilding it from rounds 0…i−1 before it predicts round i, so
            no component can be flattered by data it already saw.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Waits come from the geometric distribution: with per-round probability p, the wait to the next hit has median
            ln(0.5)/ln(1 − p) and the chance a gap already reaches g more rounds is (1 − p)^g. That last identity is the
            whole content of the drought tracker — a gap at three times its median wait is common, not a signal. The{" "}
            <Link to="/windows" className="text-accent underline underline-offset-2">
              window odds page
            </Link>{" "}
            applies the same maths over clock time: with measured cadence c seconds, a window of length T contains about
            T/c rounds and P(at least one hit) = 1 − (1 − p)^(T/c).
          </p>
          <Formula>{`P(no hit in window) = (1 − p) ** (T / c)
median wait (rounds) = ln(0.5) / ln(1 − p)
P(gap ≥ g more)      = (1 − p) ** g`}</Formula>
        </Panel>

        <Panel title="what this terminal cannot do">
          <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
            <li>
              <strong className="text-foreground">It cannot predict the next round.</strong> Not partially, not with more
              data, not with a better model. In a correctly implemented crash game the rounds are independent by
              construction.
            </li>
            <li>
              <strong className="text-foreground">It cannot find a good time to play.</strong> A best hour always exists in
              any ranking, including rankings of pure noise — which is why that page reports a chi-square across all hours
              instead of the winner's rate.
            </li>
            <li>
              <strong className="text-foreground">It cannot create a positive expectation.</strong> Every staking plan in
              the Strategy Lab has expected cost turnover × h. Kelly returns zero or negative sizing against a house edge
              (<Source href="https://en.wikipedia.org/wiki/Kelly_criterion">Kelly criterion</Source>,{" "}
              <Source href="https://crashedge.com/strategy/optimal-bet-sizing-crash-games/">bet sizing in crash games</Source>
              ).
            </li>
            <li>
              <strong className="text-foreground">It cannot audit rounds you cannot get seeds for.</strong> Verification
              needs the revealed server seed, the client seed and the nonce. Without them, "provably fair" is a marketing
              phrase.
            </li>
            <li>
              <strong className="text-foreground">It cannot tell you an operator is honest.</strong> It can tell you a
              specific round was dealt as committed, and that a sample is or is not consistent with fairness.
            </li>
          </ul>
        </Panel>

        <Panel title="the category this was built against">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Existing crash trackers such as <Source href="https://skywardstats.com/">Skyward Tracker</Source> and{" "}
            <Source href="https://aviatorix.app/">Aviatorix</Source> report history, streaks and pattern signals;
            open-source monitors like{" "}
            <Source href="https://github.com/Zakaria-laktati/crash-1xbet-monitoring">this 1xbet round monitor</Source>{" "}
            capture rounds for analysis. What none of them ship is seed verification, an independence battery, and EV
            arithmetic that states the cost of playing. Those three were the genuine gaps, and they are the reason this
            build exists.
          </p>
        </Panel>
      </div>
    </>
  );
}
