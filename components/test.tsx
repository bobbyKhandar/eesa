"use client"
import { getQuestions } from '@/db'
import { useUser } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { useEffect, useState } from 'react'

const Test = () => {
    const {user}=useUser();
    const [questions,setQuestions]=useState(null)
    useEffect(()=>{
      if(user!=null){
        async function getQuestion(email) {
         setQuestions(await getQuestions(""+email)) 
        }
        getQuestion(user?.emailAddresses);
      }
    },[user])
    return (
    <div>
      {""+questions}
      
    </div>
  )
}
  export default Test
