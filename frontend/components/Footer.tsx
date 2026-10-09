import Link from "next/link";
import { getFooterServer, LOVE_NOTE, type FooterContent } from "@/lib/site";

/** The one line that is always there, whatever the admin does with the rest of the footer. */
function LoveNote({ className = "" }: { className?: string }) {
  return <p className={`text-center text-sm text-white/60 ${className}`}>{LOVE_NOTE}</p>;
}

export function FooterView({ footer, year }: { footer: FooterContent; year: number }) {
  if (!footer.enabled) {
    return (
      <footer className="mt-12 border-t border-white/10 px-6 py-6 sm:px-10">
        <LoveNote />
      </footer>
    );
  }
  const external = (url: string) => /^(https?:|mailto:)/i.test(url);
  return (
    <footer className="mt-12 border-t border-white/10 px-6 py-8 text-sm text-white/50 sm:px-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-sm space-y-1.5">
          <p className="font-semibold text-white/80">🍬 CandyFlix</p>
          {footer.tagline && <p>{footer.tagline}</p>}
          {footer.email && (
            <p>
              <a href={`mailto:${footer.email}`} className="text-accent hover:underline">
                {footer.email}
              </a>
            </p>
          )}
        </div>
        {footer.links.length > 0 && (
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            {footer.links.map((l) =>
              external(l.url) ? (
                <a key={`${l.label}${l.url}`} href={l.url} target={l.url.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="hover:text-white">
                  {l.label}
                </a>
              ) : (
                <Link key={`${l.label}${l.url}`} href={l.url} className="hover:text-white">
                  {l.label}
                </Link>
              )
            )}
          </nav>
        )}
      </div>
      {footer.copyright && (
        <p className="mt-6 text-xs text-white/30">
          © {year} {footer.copyright}
        </p>
      )}
      <LoveNote className="mt-5" />
    </footer>
  );
}

export default async function Footer() {
  const footer = await getFooterServer();
  return <FooterView footer={footer} year={new Date().getFullYear()} />;
}
