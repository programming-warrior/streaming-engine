import Link from "next/link";

export default function Home() {
  return (
    <div className="">
         <Link href="/stream">
          Stream
         </Link>
         <Link href={"/watch"}>
          Watch
         </Link>
    </div>
  );
}
