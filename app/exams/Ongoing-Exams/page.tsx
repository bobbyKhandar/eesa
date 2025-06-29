"use client"
import {useState,useEffect} from 'react'
import { getQuestions } from '@/db'
import { useUser } from '@clerk/nextjs'
import {Card, CardHeader, CardBody, CardFooter} from "@heroui/card";
import { Divider } from '@heroui/divider'
import {Link} from '@heroui/link'
import { Image } from '@heroui/image'
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
                  <Card className="max-w-[100vw] m-[0.5vh]" key={key}>
                  <CardHeader className="flex gap-3">
                    <Image
                      alt="heroui logo"
                      height={40}
                      radius="sm"
                      src="https://avatars.githubusercontent.com/u/86160567?s=200&v=4"
                      width={40}
                    />
                    <div className="flex flex-col">
                    <div className='text-black text-[2vh]'>{exam.examName}</div>
                      <p className="text-small text-default-500">heroui.com</p>
                    </div>
                  </CardHeader>
                  <Divider />
                  <CardBody>
                    <p>Make beautiful websites regardless of your design experience.</p>
                  </CardBody>
                  <Divider />
                  <CardFooter>
                    <Link isExternal showAnchorIcon href="https://github.com/heroui-inc/heroui">
                      Visit source code on GitHub.
                    </Link>
                  </CardFooter>
                </Card>

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
