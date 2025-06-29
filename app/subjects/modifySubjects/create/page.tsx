  "use client";

  import React, { useState } from "react";
  import { Form } from "@heroui/form";
  import { Input } from "@heroui/input";
  import { Button } from "@heroui/button";
  // import FileUploadButton from "@/components/imageUploadButton";
  // import { PiUploadSimpleBold, PiUploadSimpleBold } from "@phosphor-icons/react";
  const Page = () => {
    // ✅ Hooks must be inside the component function
    const [subjectName, setSubjectName] = useState("");
    const [subjectDescription, setSubjectDescription] = useState("");
    const [subjectDegree, setSubjectDegree] = useState("");
    const [subjectSyllabus, setsubjectSyllabus] = useState(null);
    const [subjectPyq, setsubjectPyq] = useState(null);
    const [maxMarks, setmaxMarks] = useState("");
    const [subjectImg, setsubjectImg] = useState(null);
    const handleSubmit = async (event) => {
      event.preventDefault();
      const formData = new FormData();
      formData.append("subjectName", subjectName);
      formData.append("subjectDescription", subjectDescription);
      formData.append("subjectDegree", subjectDegree);
      formData.append("maxMarks", maxMarks);
      formData.append("subjectSyllabus", subjectSyllabus);
      formData.append("subjectPyq", subjectPyq);
      formData.append("subjectImg", subjectImg);

      const response = await fetch("http://localhost:8080/create_Subject", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        alert("failed to give response");
      }
    };
    const handleSyllabusChange = (event) => {
      const selectedFile = event.target.files[0];
      if (selectedFile) {
        setsubjectSyllabus(selectedFile);
      }
    };
    const handlePyqChange = (event) => {
      const selectedFile = event.target.files[0];
      if (selectedFile) {
        setsubjectPyq(selectedFile);
      }
    };
    const handleImgChange = (event) => {
      const selectedFile = event.target.files[0];
      if (selectedFile) {
        setsubjectImg(selectedFile);
      }
    };
    const handleNameChange = (event) => setSubjectName(event.target.value);
    const handleMaxMarksChange = (event) => setmaxMarks(event.target.value);
    const handleDescriptionChange = (event) =>
      setSubjectDescription(event.target.value);
    const handleDegreeChange = (event) => setSubjectDegree(event.target.value);

    return (
      <div className="flex flex-col justify-center items-center w-[100vw]">
        <Form
          className="flex flex-col justify-center items-center gap-10 min-w-[30vh]"
          onSubmit={handleSubmit}
        >
          {/* ✅ Correcting value bindings */}
          <Input
            label="Name of the Subject"
            labelPlacement="outside"
            onChange={handleNameChange}
            value={subjectName}
            placeholder="Subject Name"
            required
          />

          <Input
            label="Description of subject"
            labelPlacement="outside"
            onChange={handleDescriptionChange}
            value={subjectDescription} // ✅ Fixed
            placeholder="Subject Description"
            required
          />
          <Input
            label="Degree of subject"
            labelPlacement="outside"
            onChange={handleDegreeChange}
            value={subjectDegree}
            placeholder="Subject Degree"
            required
          />
          <Input
            label="Max marks of subject"
            labelPlacement="outside"
            type="number"
            onChange={handleMaxMarksChange}
            value={maxMarks} // ✅ Fixed
            placeholder="Max marks a student can get"
            required
          />
          <Input
            label="Syllabus of subject"
            type="file"
            labelPlacement="outside"
            onChange={handleSyllabusChange}
            required
          />

          <Input
            label="Previous years' questions of this subject"
            type="file"
            labelPlacement="outside"
            onChange={handlePyqChange}
            required
          />
          {/* <FileUploadButton
            size="lg"
            accept="image/*"
            startContent={<PiUploadSimpleBold />}
            rejectProps={{ color: "danger", startContent: <PiXCircleBold /> }}
            onUpload={(files) => {
              console.log(files[0]);
            }}
          >
            Upload
          </FileUploadButton> */}

          <Button type="submit">Submit</Button>
        </Form>
      </div>
    );
  };

  export default Page;
