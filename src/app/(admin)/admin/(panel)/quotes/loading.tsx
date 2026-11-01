import { ListRouteSkeleton } from "@/components/admin/route-skeletons";

export default function Loading() {
  return <ListRouteSkeleton label="quotes" stats={4} rows={8} actions={2} />;
}
