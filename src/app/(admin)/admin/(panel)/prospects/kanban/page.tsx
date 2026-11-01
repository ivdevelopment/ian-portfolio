import { cookies } from "next/headers";
import { BoardFilterBar, ViewToggle } from "@/components/admin/prospect-board-filters";
import { ProspectBoard } from "@/components/admin/prospect-board";
import { AdminPageHeader } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/button";
import { getPreviewConfig } from "@/lib/preview/config";
import { BOARD_DEFAULT_COLUMNS } from "@/lib/prospects/board";
import { PROSPECT_STATUSES, type ProspectStatus } from "@/lib/prospects/constants";
import { brusselsToday } from "@/lib/prospects/dates";
import { filtersToParams, parseFilters } from "@/lib/prospects/filters";
import { BOARD_LIMIT, listBoardCards, listSectors } from "@/lib/prospects/queries";

/** Saved column choice (cookie), validated against the real statuses; the default pipeline otherwise. */
function savedColumns(raw: string | undefined): ProspectStatus[] {
  const picked = (raw ?? "").split(",").filter((s): s is ProspectStatus => (PROSPECT_STATUSES as readonly string[]).includes(s));
  return picked.length > 0 ? picked : [...BOARD_DEFAULT_COLUMNS];
}

export default async function ProspectKanbanPage({ searchParams }: PageProps<"/admin/prospects/kanban">) {
  const filters = parseFilters(await searchParams);
  const today = brusselsToday();
  const jar = await cookies();
  const visible = savedColumns(jar.get("prospect_board_columns")?.value);
  const { baseDomain } = getPreviewConfig();

  const [{ cards, total }, sectors] = await Promise.all([listBoardCards(filters, today), listSectors()]);
  const query = filtersToParams(filters).toString();

  return (
    <>
      <AdminPageHeader
        title="Prospects"
        description="Drag a prospect to change its status, or use its menu."
        actions={
          <>
            <ViewToggle current="kanban" query={query} />
            <ButtonLink href="/admin/prospects/new" size="sm" icon="none">
              New prospect
            </ButtonLink>
          </>
        }
      />
      <div className="space-y-3">
        <BoardFilterBar filters={filters} sectors={sectors} />
        <ProspectBoard cards={cards} today={today} visible={visible} total={total} truncated={total > BOARD_LIMIT} baseDomain={baseDomain} />
      </div>
    </>
  );
}
