import MenuClient from "@/components/MenuClient";

export const dynamic = "force-dynamic";

export default function CounterPage({ params }: { params: { slug: string } }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <MenuClient slug={params.slug} />
    </main>
  );
}