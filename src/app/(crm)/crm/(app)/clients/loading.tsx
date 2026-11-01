import { ListRouteSkeleton } from "@/components/admin/route-skeletons";

export default function Loading() {
  return <ListRouteSkeleton label="clients" rows={5} actions={0} />;
}
