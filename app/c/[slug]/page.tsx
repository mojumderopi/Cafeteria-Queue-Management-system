import MenuClient from "@/components/MenuClient";

export const dynamic = "force-dynamic";

export default function CounterPage({ params }: { params: { slug: string } }) {
  return <MenuClient slug={params.slug} />;
}
