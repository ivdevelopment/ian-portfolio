import { ListRouteSkeleton } from "@/components/admin/route-skeletons";

export default function Loading() {
  return <ListRouteSkeleton label="follow-ups" rows={6} actions={0} />;
}
