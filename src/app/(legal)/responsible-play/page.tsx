import type { Metadata } from "next";
import { LegalArticle } from "@/components/shared/legal-article";

export const metadata: Metadata = {
  title: "Responsible Play",
  description:
    "The platform's position on gambling harm, the warning signs to watch for, and where to find help in India and internationally.",
  alternates: { canonical: "/responsible-play" },
};

export default function ResponsiblePlayPage() {
  return (
    <LegalArticle
      eyebrow="Player Safety"
      title="Responsible Play"
      updatedAt="18 September 2026"
      intro="This platform publishes statistical models, not guarantees. If any part of your engagement with cricket analytics stops feeling like research and starts feeling like compulsion, stop and reach out for help."
      sections={[
        {
          id: "our-position",
          heading: "Our position",
          body: (
            <>
              <p>
                We are an <strong>analytics community</strong>. Our models
                produce probability estimates from historical data. A model
                saying a team has a 72% win probability means the other team wins
                28% of the time — that is not an error, it is the point.
              </p>
              <p>
                We never guarantee an outcome, never publish &ldquo;fixed&rdquo;
                information, and never encourage anyone to stake money they
                cannot afford to lose. Anyone representing this platform as a
                guaranteed tip service is misrepresenting it.
              </p>
            </>
          ),
        },
        {
          id: "legal",
          heading: "Know the law where you live",
          body: (
            <>
              <p>
                Wagering laws differ enormously between jurisdictions and change
                frequently. In India, the Public Gambling Act 1867 and various
                state-level statutes restrict gambling, and several states have
                specific provisions regarding online wagering. Rules also apply
                to financial transactions connected to such activity.
              </p>
              <p>
                <strong>
                  It is your responsibility to understand and comply with the law
                  where you are.
                </strong>{" "}
                Nothing on this platform should be read as legal advice or as
                permission to engage in any activity that is unlawful for you.
              </p>
            </>
          ),
        },
        {
          id: "warning-signs",
          heading: "Warning signs",
          body: (
            <>
              <p>
                Problem gambling rarely announces itself. Watch for any of these
                in yourself or someone close to you:
              </p>
              <ul>
                <li>Staking more than you planned, repeatedly, to chase a loss.</li>
                <li>Hiding the extent of your activity from family or friends.</li>
                <li>Borrowing money, or selling belongings, to continue.</li>
                <li>Neglecting work, study, sleep or relationships to keep going.</li>
                <li>Feeling irritable or anxious when you cannot participate.</li>
                <li>Believing a system or model will definitely recover your losses.</li>
              </ul>
              <p>
                Two or more of these together is a strong signal to stop and seek
                support — not a signal to try harder.
              </p>
            </>
          ),
        },
        {
          id: "rules",
          heading: "Rules we recommend",
          body: (
            <ul>
              <li>
                <strong>Set a hard limit before you start</strong> — a figure you
                would be comfortable losing entirely, and treat it as spent.
              </li>
              <li>
                <strong>Never chase losses.</strong> Increasing a stake to recover
                a previous result is the single most reliable path to harm.
              </li>
              <li>
                <strong>Never borrow to participate.</strong> Not from family, not
                from credit, not from a lender.
              </li>
              <li>
                <strong>Cap your time</strong>, not just your money. Set an alarm.
              </li>
              <li>
                <strong>Take regular breaks</strong> — days off, not hours.
              </li>
              <li>
                <strong>Treat it as entertainment spend</strong>, never as income
                or an investment strategy.
              </li>
            </ul>
          ),
        },
        {
          id: "support",
          heading: "Where to get help",
          body: (
            <>
              <p>
                If you or someone you know needs support, these services operate
                in India and internationally:
              </p>
              <ul>
                <li>
                  <strong>Tele-MANAS</strong> — India&rsquo;s national mental
                  health helpline. Dial <strong>14416</strong> (24×7, multiple
                  languages).
                </li>
                <li>
                  <strong>Kiran Mental Health Helpline</strong> — dial{" "}
                  <strong>1800-599-0019</strong> (24×7, 13 languages).
                </li>
                <li>
                  <strong>AASRA</strong> — +91 98204 66726, for emotional support
                  and counselling.
                </li>
                <li>
                  <strong>Gamblers Anonymous</strong> — peer support groups with
                  an India chapter; see{" "}
                  <a
                    href="https://www.gamblersanonymous.org"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    gamblersanonymous.org
                  </a>
                  .
                </li>
                <li>
                  <strong>GamCare</strong> (UK) —{" "}
                  <a
                    href="https://www.gamcare.org.uk"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    gamcare.org.uk
                  </a>
                  , free confidential advice.
                </li>
              </ul>
              <p>
                If you are in immediate distress, please contact your local
                emergency number. You do not have to manage this alone.
              </p>
            </>
          ),
        },
        {
          id: "self-exclusion",
          heading: "Self-exclusion from this platform",
          body: (
            <p>
              If you would like your membership closed so that you cannot access
              the terminal or its models, email{" "}
              <a href="mailto:support@example.com">support@example.com</a> with
              the subject <strong>&ldquo;Self-exclusion&rdquo;</strong>. The
              request is actioned within 24 hours, the account is hard-deleted,
              and the associated email address is added to a suppression list so
              no new account can be created with it. No reason is required and
              none will be asked for.
            </p>
          ),
        },
      ]}
      footer={
        <p className="text-[13.5px] leading-relaxed text-zinc-400">
          <strong className="text-zinc-200">18+ only.</strong> This platform is
          for research and entertainment purposes. It is not a betting service
          and does not accept, hold or process wagers of any kind.
        </p>
      }
    />
  );
}
