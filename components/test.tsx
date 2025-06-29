"use client";
import React, { useState } from "react";

const Test = () => {
  const [file, setFile] = useState(null);
  const [fName, setFName] = useState("");
  // Handle file selection
  const handleFileChange = (event) => {
    const selectedFile = event.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };
  const handleNameChange = (event) => {
    setFName(event.target.value);
  };
  // Upload file using FormData
  const createExam = async (event) => {
    event.preventDefault(); // Prevent form default behavior

    if (!file) {
      alert("No file selected!");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", fName);
      console.log(formData);
      // const response = await fetch("http://localhost:8080/create_Exam", {
      //   method: "POST",
      //   body: formData, // Sending multipart/form-data
      // });

      // if (!response.ok) throw new Error("Exam creation failed");

      // const result = await response.json();
      // console.log("Exam Creation Success:", result);
      // alert("Exam created successfully!");
    } catch (error) {
      console.error("Exam Creation Error:", error);
      alert("Exam creation failed.");
    }
  };

  return (
    <div>
      <form onSubmit={createExam}>
        <input type="file" name="file" onChange={handleFileChange} required />
        <input
          type="text"
          name="fName"
          value={fName}
          onChange={handleNameChange}
          required
        />
        <button type="submit">Upload File</button>
      </form>
    </div>
  );
};

export default Test;
