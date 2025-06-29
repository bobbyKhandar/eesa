// app/api/user/route.ts
import { NextResponse } from "next/server";
import { connect, getuserModel } from "@/models";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    await connect();
    const userModel = await getuserModel();
    const userInfo = await userModel.findOne({
      useremail: searchParams.get("email"),
    });
    console.log(userInfo);
    return NextResponse.json(userInfo);
  } catch (error) {
    console.log(error);
  }
}
