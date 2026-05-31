import { NextRequest, NextResponse } from "next/server";
export default async function POST(req:NextRequest){
    const {inputMessage}=await req.json()
    
}