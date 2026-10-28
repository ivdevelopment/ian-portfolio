import { Eyebrow } from "./eyebrow";
import { Reveal } from "./reveal";

type PageHeaderProps = {
  eyebrow?: string;
  title: React.ReactNode;
  description?: string;
  children?: React.ReactNode;
};

/** Standard heading block for inner pages. Renders the page's single <h1>. */
export function PageHeader({ eyebrow, title, description, children }: PageHeaderProps) {
  return (
    <header className="container-page page-top pb-12 sm:pb-16">
      <Reveal y={12}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="text-display mt-4 max-w-4xl text-balance">{title}</h1>
        {description && (
          <p className="mt-6 max-w-2xl text-lg text-muted">{description}</p>
        )}
        {children}
      </Reveal>
    </header>
  );
}
