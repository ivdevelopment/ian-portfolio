import { ListRouteSkeleton } from "@/components/admin/route-skeletons";

export default function Loading() {
  return <ListRouteSkeleton label="projects" rows={8} />;
}
