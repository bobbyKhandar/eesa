import { auth } from "@clerk/nextjs/server";
export default async function Home() {
  const sessionClaims= await auth();
  
  return (
    <div className="min-h-full min-w-full">
     
    </div>
  );
}
