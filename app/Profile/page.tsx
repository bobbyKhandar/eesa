import { UserProfile } from '@clerk/nextjs'
import React from 'react'

const page = () => {
  return (
    <div className='ml-[30vh] p-[5vh] left-[40vh]'>
     <UserProfile/>
    </div>
  )
}

export default page
