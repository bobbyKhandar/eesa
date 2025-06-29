"use client"
import { useUser } from '@clerk/nextjs'
import React, { useEffect } from 'react'
import Questionnaire from "@/components/ui/Questionnaire"
import { SignedIn, SignedOut } from '@clerk/nextjs'

const Page = () => {
  const {user}  = useUser(); // Call the hook at the top level
  const [email,setEmail]= React.useState(null);
  useEffect(()=>{
    setEmail(user)
    console.log(email);
  },[user])


  return (
    <div>
      <SignedOut>Please sign in in order to give exams</SignedOut>
      <SignedIn>
        <Questionnaire emailAddresses={user?.emailAddresses.map(email => email.emailAddress)} />
      </SignedIn>
    </div>
  )
}

export default Page;
