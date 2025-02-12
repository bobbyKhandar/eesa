"use client";

import { ClerkProvider, SignInButton, SignedIn, SignedOut, UserButton, useUser } from "@clerk/nextjs";
import {
  Navbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
  NavbarMenuToggle,
  NavbarMenu,
  NavbarMenuItem,
} from "@heroui/navbar";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import {setUser,getUserRole} from "@/db"
import AdminPage from "./AdminPage";
import { Button } from "@heroui/button";

const Header = ({ prompts }) => {
  const AcmeLogo = () => {
    return (
      <svg fill="none" height="36" viewBox="0 0 32 32" width="36">
        <path
          clipRule="evenodd"
          d="M17.6482 10.1305L15.8785 7.02583L7.02979 22.5499H10.5278L17.6482 10.1305ZM19.8798 14.0457L18.11 17.1983L19.394 19.4511H16.8453L15.1056 22.5499H24.7272L19.8798 14.0457Z"
          fill="currentColor"
          fillRule="evenodd"
        />
      </svg>
    );
  };
  const {user}=useUser();
  useEffect(()=>{
    async function SetuserRoles(){
      if(user!=null)setUser(user?.emailAddresses[0].emailAddress);
      
    }
    async function getRole() {
      if(user!=null)setUserRole(await getUserRole(user?.emailAddresses[0].emailAddress));
   }
   SetuserRoles()
   getRole()
  },[user])
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const [userRole,setUserRole]=useState(null);
  
  const menuItems = {
    Profile: "Profile",
    Dashboard: "Dashboard",
    "Ongoing Exams": "exam/Ongoing-Exams",
    "Completed Exams": "exam/Completed-Exams",
    History: "profile/history",
    "My Subjects": "profile/user-subjects",
    "Help & Feedback": "profile/support",
  };

  return (
    <Navbar className="flex items-center justify-between w-full" onMenuOpenChange={setIsMenuOpen}>
      <NavbarContent>
        <NavbarMenuToggle aria-label={isMenuOpen ? "Close menu" : "Open menu"} />
        <Link href="./" onClick={() => setIsMenuOpen(false)}>
          <NavbarBrand>
            <AcmeLogo />
            EESA
          </NavbarBrand>
        </Link>
      </NavbarContent>

      {prompts && Object.keys(prompts).length > 0 && (
        <NavbarMenu>
          {Object.entries(prompts).map(([key, item], index) => (
            <NavbarMenuItem key={`${item}-${index}`}>
              <Link className="w-full" href={`/${item}`}>
                {key}
              </Link>
            </NavbarMenuItem>
          ))}
        </NavbarMenu>
      )}
         <NavbarItem>
          {/* <AdminPage/> */}{userRole=="admin"&&<Link href="./admin"><Button>Admin</Button></Link>}
        </NavbarItem>
      <NavbarContent className="ml-[85vw]">
        <NavbarItem>
          <ClerkProvider>
            <SignedOut>
              <SignInButton />
            </SignedOut>
            <SignedIn>
           
              <UserButton />
            </SignedIn>
          </ClerkProvider>
        </NavbarItem>
     
      </NavbarContent>
      
      <NavbarMenu>
        {Object.entries(menuItems).map(([key, item], index) => (
          <NavbarMenuItem key={`${item}-${index}`}>
            <Link className="w-full" href={`/${item}`}>
              {key}
            </Link>
          </NavbarMenuItem>
        ))}
      </NavbarMenu>
    </Navbar>
  );
};

export default Header;
