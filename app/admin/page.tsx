"use client"
import { getUserRole,getUsers,changeRoles } from '@/db';
import { useUser } from '@clerk/nextjs'
import  { useEffect, useState } from 'react'
import {Table, TableHeader, TableColumn, TableBody, TableRow, TableCell} from "@heroui/table";
import {Dropdown, DropdownTrigger, DropdownMenu, DropdownItem} from "@heroui/dropdown";
import { Button } from '@heroui/button';

const Page = () => {
    const {user}=useUser();
    const [userRole,setUserRole]=useState(null);
    const [users,setUsers]=useState(null);
    
    useEffect(()=>{
        async function setrole() {      
            if(user!=null)setUserRole(await getUserRole(user?.emailAddresses[0].emailAddress)) 
        }
        async function getUsersfromdb() {   
          const result = await getUsers();
          setUsers(result);
        }
        getUsersfromdb();
    setrole()
    console.log(users)
    },[user])
    function changeRole(emailAddress,role){
      changeRoles(emailAddress,role);
    }
  return (
    <div>
      {userRole=="admin"?
      ( 
      <div>
        
      <Table removeWrapper  >
      <TableHeader >
        <TableColumn >NAME</TableColumn>
        <TableColumn>ROLE</TableColumn>
        <TableColumn>STATUS</TableColumn>
      </TableHeader>
      <TableBody >
        {
          users.map((arr,key)=>{
            return(

          <TableRow key={key}>
          <TableCell>{arr.useremail}</TableCell>
          <TableCell>{arr.userRole}</TableCell>
          <TableCell>
          <Dropdown>
      <DropdownTrigger>
        <Button variant="bordered">Open Menu</Button>
      </DropdownTrigger>
      <DropdownMenu aria-label="Static Actions" className='bg-gray' color="secondary">
        <DropdownItem className='text-black' key="student" onPress={()=>{changeRole(arr.useremail,"student")}}>make user student</DropdownItem>
        <DropdownItem className='text-black' key="faculty" onPress={()=>{changeRole(arr.useremail,"faculty")}}>make user faculty</DropdownItem>
        <DropdownItem className="text-black" color='primary' key="admin" onPress={()=>{changeRole(arr.useremail,"admin")}}>make user admin</DropdownItem>
        <DropdownItem key="delete" className="text-danger" color="danger">
          Delete user
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
          </TableCell>
        </TableRow> 
          )
          })
        }
      </TableBody>
    </Table>
      </div>
      )
      :(<div>Feching your role in this organization please wait..   <br/>attention     if you are not the admin this page wont update </div>)}
    </div>
  )
}

export default Page
