import NotFoundState from "@/components/NotFoundState";

// notFound() from a (main) page (e.g. an unknown movie id) — renders
// inside the (main) layout, so the header and search stay available.
export default function NotFound() {
  return <NotFoundState />;
}
