import React from 'react'
import { Card,CardFooter } from '@heroui/card'
import Image from 'next/image'
import Link from 'next/link'
const page = () => {
  return (
    <div className='flex flex-row gap-[3vh] items-center justify-center min-w-screen min-h-screen'>
                <Card className='max-w-fit rounded-[2vw] bg-parent flex it' isFooterBlurred>
                  <Link
                  href="/subjects/modifySubjects/create"
                  >  
            <Image
                src="/create-subject.jfif"
                alt="error?"
                width="500"
                height="500"
                />
              <CardFooter className='justify-center before:bg-white/10 h-[7vh] border-white/20 border-1 overflow-hidden absolute before:rounded-xl rounded-large bottom-[2vh] w-[calc(100%_-_8px)] shadow-small ml-1 z-10'> Create An Exam</CardFooter>
                </Link>
            </Card>
            <Card className='max-w-fit rounded-[2vw] bg-parent flex it' isFooterBlurred>
            <Image
                src="/create-subject.jfif"
                alt="error?"
                width="500"
                height="500"
              />
              <CardFooter className='justify-between before:bg-white/10 h-[7vh] border-white/20 border-1 overflow-hidden absolute before:rounded-xl rounded-large bottom-[2vh] w-[calc(100%_-_8px)] shadow-small ml-1 z-10'>Hello</CardFooter>
            </Card>
            <Card className='max-w-fit rounded-[2vw] bg-parent flex it' isFooterBlurred>
            <Image
                src="/create-subject.jfif"
                alt="error?"
                width="500"
                height="500"
              />
              <CardFooter className='justify-between before:bg-white/10 h-[7vh] border-white/20 border-1 overflow-hidden absolute before:rounded-xl rounded-large bottom-[2vh] w-[calc(100%_-_8px)] shadow-small ml-1 z-10'>Hello</CardFooter>
            </Card>
    </div>
  )
}

export default page
