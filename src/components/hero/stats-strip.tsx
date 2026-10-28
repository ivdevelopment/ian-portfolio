import { visibleStats } from "@/lib/schemas/site-content";
import { getHomeContent } from "@/lib/site-content";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/ui/reveal";

export async function StatsStrip() {
  const { stats: all } = await getHomeContent();
  const stats = visibleStats(all);
  if (stats.length === 0) return null;

  return (
    <section aria-label="Highlights">
      <div className="container-page">
        <Reveal>
          <dl className="grid grid-cols-2 border-y border-line lg:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
            {stats.map((stat, i) => (
              <div
                key={`${i}-${stat.label}`}
                className={cn(
                  "flex flex-col-reverse justify-end border-line py-7 sm:py-9",
                  "lg:border-l lg:px-8 lg:first:border-l-0 lg:first:pl-0",
                  i % 2 === 0 ? "max-lg:pr-6" : "max-lg:border-l max-lg:pl-6",
                  i >= 2 && "max-lg:border-t",
                )}
              >
                <dt className="mt-1 text-sm text-muted">{stat.label}</dt>
                <dd className="text-title">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
