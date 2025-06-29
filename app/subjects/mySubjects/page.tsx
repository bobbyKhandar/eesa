"use client";
import { useUser } from "@clerk/nextjs";
import React, { useEffect, useState } from "react";
import { getSubjects } from "@/db.js";
import { error } from "console";
import { Card, CardHeader, CardBody } from "@heroui/card";
import { Image } from "@heroui/Image";
const page = () => {
  const [subjects, setSubjects] = useState([]);
  const { user } = useUser();
  useEffect(() => {
    async function getSubject() {
      try {
        if (user?.emailAddresses?.length > 0) {
          const response = await fetch("http://localhost:8080/getSubjects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: user?.emailAddresses[0].emailAddress,
            }),
          });
          if (!response.ok) {
            throw new Error("Failed to fetch subjects");
          }
          const { subjects } = await response.json();

          setSubjects(subjects);
        }
      } catch (error) {
        console.log(error);
      }
    }
    getSubject();
  }, [user]);
  return (
    <div>
      <Card className="py-4 bg-inherit flex flex-col">
        {subjects.length === 0 ? (
          <>fetching your data.........</>
        ) : (
          <>
            {subjects?.map((subject, index) => {
              return (
                <div key={index}>
                  <CardHeader className="pb-0 pt-2 px-4 flex-col items-start">
                    <p className="text-tiny uppercase font-bold">
                      {subject.subjectName}
                    </p>
                    <small className="text-default-500">
                      {subject.subjectDescription}
                    </small>
                    <h4 className="font-bold text-large">
                      max marks student can pursue:-{subject.subjectDegree}
                    </h4>
                  </CardHeader>
                  <CardBody className="overflow-visible py-2">
                    <Image
                      alt="Card background"
                      className="object-cover rounded-xl"
                      src="https://heroui.com/images/hero-card-complete.jpeg"
                      width={270}
                    />
                  </CardBody>
                </div>
              );
            })}
          </>
        )}
      </Card>
    </div>
  );
};

export default page;
