"use client"
import {useState,useEffect} from 'react'
import Link from 'next/link'
import { getQuestions } from '@/db'
import { useUser } from '@clerk/nextjs'

const Page = () => {
const [questions,setQuestions]=useState(null);
const {user}=useUser();
useEffect(()=>{
  async function getquestionsdb() {
    setQuestions(await getQuestions(user?.emailAddresses[0].emailAddress));
  }
  getquestionsdb()
},[user])  

  return (
    <div>
      {
        questions!=null&&(
          <div>
            {
              questions.map((exam,key)=>{
                return(
                <div key={key}>{exam.examName }</div>
                )
              })
            }
          </div>
        )
      }
    </div>
  )
}

export default Page
