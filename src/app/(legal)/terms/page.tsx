import type { Metadata } from "next";
import { LegalArticle } from "@/components/shared/legal-article";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The rules that govern your membership of the Cricket Prediction Community, including account eligibility, acceptable use and the referral programme.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalArticle
      eyebrow="Legal"
      title="Terms of Service"
      updatedAt="18 September 2026"
      intro="These terms form the agreement between you and the Cricket Prediction Community platform. By registering an account you accept them in full, so please read them before you activate your membership."
      sections={[
        {
          id: "eligibility",
          heading: "Eligibility",
          body: (
            <>
              <p>
                Membership is restricted to individuals aged{" "}
                <strong>18 years or older</strong> who can form a binding
                contract in their jurisdiction. By registering you confirm that
                you meet these requirements.
              </p>
              <p>
                One membership is granted per verified Google account. Creating
                multiple accounts to obtain additional referral credit, evade a
                suspension or inflate community standings is prohibited and will
                result in termination of every linked account.
              </p>
            </>
          ),
        },
        {
          id: "account",
          heading: "Your account",
          body: (
            <>
              <p>
                Authentication is delegated entirely to Google. We never receive
                or store your Google password. You are responsible for
                maintaining the security of the Google account you register
                with, and for all activity carried out under your member record.
              </p>
              <p>
                Notify us immediately if you believe your account has been
                compromised. Sessions are issued as 30-day JSON Web Tokens and
                can be invalidated at any time by signing out.
              </p>
            </>
          ),
        },
        {
          id: "acceptable-use",
          heading: "Acceptable use",
          body: (
            <>
              <p>You agree not to:</p>
              <ul>
                <li>
                  Reverse-engineer, decompile or repackage the Android terminal,
                  or redistribute the APK to non-members.
                </li>
                <li>
                  Scrape, cache or resell platform data, including model output,
                  community consensus figures and referral graphs.
                </li>
                <li>
                  Automate requests in a way that degrades service for other
                  members, including credential stuffing and enumeration of
                  referral codes.
                </li>
                <li>
                  Use the platform to harass other members, publish unlawful
                  material, or misrepresent the platform&rsquo;s projections as
                  guaranteed outcomes.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "referrals",
          heading: "Referral programme",
          body: (
            <>
              <p>
                Each member receives one automatically generated referral code. A
                new member is attributed to a referrer only when the code is
                valid at the moment their account is provisioned.
              </p>
              <p>
                Self-referral is blocked server-side. Incentives tied to
                referrals may be adjusted or withdrawn if we detect fraudulent
                attribution, bulk account creation or coordinated abuse.
              </p>
            </>
          ),
        },
        {
          id: "no-advice",
          heading: "No financial advice",
          body: (
            <>
              <p>
                Every projection, probability and consensus figure published on
                this platform is a{" "}
                <strong>statistical estimate produced for research and
                entertainment</strong>. Nothing here constitutes financial,
                investment, betting or professional advice, and no outcome is
                ever guaranteed.
              </p>
              <p>
                You are solely responsible for any decision you make. If you
                choose to participate in any wagering activity, do so only where
                it is lawful, only with money you can afford to lose, and never
                as a source of income.
              </p>
            </>
          ),
        },
        {
          id: "software-licence",
          heading: "Software licence",
          body: (
            <>
              <p>
                The Android terminal is licensed to you, not sold. The licence is
                personal, non-transferable and revocable, and terminates
                automatically if your membership ends. Downloading the build does
                not grant you ownership of any part of the software, models or
                data.
              </p>
              <p>
                Builds are distributed directly rather than through the Play
                Store. You accept the associated risk of sideloading and are
                responsible for verifying the SHA-256 checksum published on the
                Download Center page.
              </p>
            </>
          ),
        },
        {
          id: "availability",
          heading: "Availability and changes",
          body: (
            <>
              <p>
                The service is provided on an &ldquo;as is&rdquo; and
                &ldquo;as available&rdquo; basis without warranties of any kind.
                We do not guarantee uninterrupted availability, that models will
                remain accurate, or that any particular feature will be
                maintained.
              </p>
              <p>
                We may modify, suspend or discontinue any part of the platform,
                and may revise these terms. Material changes will be announced
                on this page with an updated revision date. Continued use after a
                change constitutes acceptance.
              </p>
            </>
          ),
        },
        {
          id: "liability",
          heading: "Limitation of liability",
          body: (
            <p>
              To the maximum extent permitted by law, the platform and its
              operators are not liable for indirect, incidental, special,
              consequential or punitive damages, nor for lost profits, data or
              goodwill, arising from your use of the service — including any
              decision made on the basis of a projection. Where liability cannot
              be excluded, it is limited to the amount you paid us, which for a
              free membership is zero.
            </p>
          ),
        },
        {
          id: "termination",
          heading: "Termination",
          body: (
            <p>
              You may terminate this agreement at any time by requesting account
              deletion. We may suspend or terminate your membership immediately
              if you breach these terms. On termination your licence to the
              software ends and you must remove the application from your
              devices.
            </p>
          ),
        },
      ]}
      footer={
        <p className="text-[13.5px] leading-relaxed text-zinc-400">
          Questions about these terms? Write to{" "}
          <a
            href="mailto:support@example.com"
            className="text-red-400 underline-offset-4 hover:underline"
          >
            support@example.com
          </a>
          . This document is provided for platform transparency and is not a
          substitute for jurisdiction-specific legal review.
        </p>
      }
    />
  );
}
