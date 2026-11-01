import { ListRouteSkeleton } from "@/components/admin/route-skeletons";

export default function Loading() {
  return <ListRouteSkeleton label="prospects" stats={6} rows={10} actions={3} />;
}
