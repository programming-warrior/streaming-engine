import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center gap-6">
         <Link href="/stream">
          <span className="bg-red-500 text-white p-2 rounded-sm">
          Stream
          </span>
         </Link>
         <Link href={"/watch"}>
         <span className="bg-blue-500 text-white p-2 rounded-sm">
          Watch
         </span>
         </Link>
    </div>
  );
}
