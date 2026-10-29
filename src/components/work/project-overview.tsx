import { Check } from "lucide-react";
import type { Project } from "@/types/project";
import { Reveal } from "@/components/ui/reveal";
import { isConceptProject } from "@/lib/project-labels";

const typeLabels: Record<NonNullable<Project["projectType"]>, string> = {
  client: "Client project",
  personal: "Personal project",
  concept: "Concept",
};

export function ProjectOverview({ project }: { project: Project }) {
  const details: { label: string; value: React.ReactNode }[] = [];
  // A concept isn't commissioned work: the named company is the subject, not a client.
  if (project.client)
    details.push({ label: isConceptProject(project) ? "Brand" : "Client", value: project.client });
  if (project.projectType)
    details.push({ label: "Type", value: typeLabels[project.projectType] });
  if (project.year) details.push({ label: "Year", value: project.year });
  if (project.technologies.length > 0)
    details.push({ label: "Technologies", value: project.technologies.join(", ") });
  if (project.liveUrl)
    details.push({
      label: "Live URL",
      value: (
        <a
          href={project.liveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-accent underline-offset-4 hover:underline"
        >
          {project.liveUrl.replace(/^https?:\/\//, "")}
        </a>
      ),
    });

  return (
    <section aria-label="Project overview" className="container-page section-y pt-14 sm:pt-20">
      <Reveal className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="glass rounded-panel p-6 sm:p-9">
          <h2 className="text-title">Project overview</h2>
          {project.description && (
            <p className="mt-4 max-w-2xl text-muted">{project.description}</p>
          )}
          {project.keyFeatures.length > 0 && (
            <>
              <h3 className="mt-8 text-sm font-medium tracking-[0.14em] text-subtle uppercase">
                Key features
              </h3>
              <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {project.keyFeatures.map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-[0.95rem]">
                    <span
                      aria-hidden
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
                    >
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="glass rounded-panel p-6 sm:p-9">
          <h2 className="text-title">Project details</h2>
          <dl className="mt-5 divide-y divide-line">
            {details.map((d) => (
              <div
                key={d.label}
                className="grid grid-cols-[7rem_1fr] gap-4 py-3.5 text-[0.95rem]"
              >
                <dt className="text-muted">{d.label}</dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Reveal>
    </section>
  );
}
