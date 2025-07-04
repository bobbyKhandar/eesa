"use client";
import { Form } from "@heroui/form";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Radio, RadioGroup } from "@heroui/radio";
import { createExam, getUserRole } from "@/db.js";
import { useUser } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";

const Page = () => {
  const { user } = useUser();
  const [role, setRole] = useState("user");
  const [questionArr, setQuestionArr] = useState([""]); // Store input values
  const inputRef = useRef([""]);

  const [questionsai, setQuestions] = useState([]);
  const [response, setResponse] = useState("0");
  const [readOnlyStates, setReadOnlyStates] = useState(
    Array(questionArr.length).fill(true) // Initialize all inputs as read-only
  );
  useEffect(() => {
    async function getRole() {
      if (user != null)
        setRole(await getUserRole(user?.emailAddresses[0].emailAddress));
    }
    getRole();
  }, [user]);
  const printinput = () => {
    console.log("hi");
    console.log(questionsai);
  };
  const onSubmit = (e) => {
    e.preventDefault();
    if (response == "0") {
      const formData = new FormData(e.currentTarget);
      setResponse(Object.fromEntries(formData).examType);
    } else if (response == "form-personal") {
      const formdata = new FormData(e.currentTarget);
      const examname = formdata.get("examName");
      const maxmarks = formdata.get("maxMarks");
      const passingPercentage = formdata.get("passingPercentage");
      formdata.delete("examName");
      formdata.delete("maxMarks");
      formdata.delete("passingPercentage");
      console.log(Object.fromEntries(formdata));
      createExam(
        examname,
        "personal",
        "",
        maxmarks,
        passingPercentage,
        "",
        user?.emailAddresses[0].emailAddress,
        Object.fromEntries(formdata)
      );
    } else if (response == "ai-personal") {
      const formdata = new FormData(e.currentTarget);
      const examname = formdata.get("examName");
      const maxmarks = formdata.get("maxMarks");
      const passingPercentage = formdata.get("passingPercentage");
      createExam(
        examname,
        "personal",
        "",
        maxmarks,
        passingPercentage,
        "",
        user?.emailAddresses[0].emailAddress,
        questionsai
      );
    }
  };
  const changeQuestionArr = () => {
    console.log();
  };
  const addQuestion = () => {
    setQuestionArr([...questionArr, ""]); // Adds a new empty input field
  };
  const [file, setFile] = useState(null);

  // Convert file to Base64
  const toBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result.split(",")[1]); // Extract base64 content
      reader.onerror = (error) => reject(error);
    });
  };

  // Handle file selection
  const handleFileChange = (event) => {
    const selectedFile = event.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleUpdate = async (e) => {
    console.log("change detected" + e.target.value);
    console.log(parseInt(e.target.id));
    setQuestions((prevStates) =>
      prevStates.map((question, i) =>
        i === parseInt(e.target.id) ? e.target.value : question
      )
    );
  };
  // Upload file to Gemini backend
  const uploadPDFToGemini = async (e) => {
    e.preventDefault();
    if (!file) {
      alert("No file selected!");
      return;
    } else {
      console.log("Ho");
    }
    try {
      console.log(e.target.marks);
      const base64File = await toBase64(file);
      const response = await fetch("http://localhost:3001/upload-gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: base64File, size: 100, marks: 80 }),
      });
      if (!response.ok) throw new Error("Gemini upload failed");
      const result = await response.json();
      console.log("Gemini Upload Success:", result);
      setQuestions([...result.response.questions]);
      alert("File uploaded to Gemini successfully!");
    } catch (error) {
      console.error("Gemini Upload Error:", error);
      alert("Gemini upload failed.");
    }
  };
  const changeStateInput = (index) => {
    setReadOnlyStates((prevStates) =>
      prevStates.map((state, i) => (i === index ? !state : state))
    );
  };
  return (
    <div className="flex items-center justify-center  w-[100%]">
      <Form className="w-[100vw]" onSubmit={onSubmit}>
        {response === "0" && (
          <>
            <RadioGroup
              color="warning"
              label="Select one of the options"
              name="examType"
            >
              <Radio
                description="Create a personalized exam only by uploading your syllabus"
                value="ai-personal"
              >
                Personalized AI Questions
              </Radio>
              <Radio
                description="Create your own exam with questions of your choice"
                value="form-personal"
              >
                Personal Questions
              </Radio>
              {(role === "admin" || role === "faculty") && (
                <>
                  <Radio
                    description="Create an exam for students only by uploading your syllabus"
                    value="ai-faculty"
                  >
                    Create Exam Using AI Questions for Students
                  </Radio>
                  <Radio
                    description="Create an exam for students with questions of your choice"
                    value="form-faculty"
                  >
                    Create Exam for Students Using Your Personal Questions
                  </Radio>
                </>
              )}
            </RadioGroup>
            <Button type="submit">Next</Button>
          </>
        )}

        {response === "form-personal" && (
          <>
            <div className="flex flex-col gap-2">
              <Input
                radius="md"
                isRequired
                label="exam name"
                labelPlacement="outside"
                name="examName"
                placeholder="Enter your exams name"
                type="email"
              />

              <Input
                radius="md"
                radius="md"
                isRequired
                label="passing percentage of exam"
                labelPlacement="outside"
                name="passingPercentage"
                placeholder="enter your passing percentage here!"
                type="email"
              />

              {questionArr.map((_, index) => (
                <Input
                  radius="md"
                  radius="md"
                  key={index}
                  isRequired
                  label={`Question ${index + 1}`}
                  labelPlacement="outside"
                  name={`question-${index}`}
                  placeholder="Enter your question"
                  type="email"
                />
              ))}

              <Input
                radius="md"
                radius="md"
                isRequired
                label="Maximum marks"
                labelPlacement="outside"
                name="maxMarks"
                placeholder="Enter maxMarks"
                type="email"
              />
            </div>

            <Button type="button" onPress={addQuestion} className="mt-2">
              Add Question
            </Button>
          </>
        )}
        {response === "ai-personal" && (
          <div className="flex m-[10vw] top-[50vh] flex-col w-[100%] gap-2">
            <Input
              radius="md"
              isRequired
              className="max-w-[80%]"
              label="exam name"
              labelPlacement="outside"
              name="examName"
              placeholder="Enter your exams name"
              type="email"
              variant="bordered"
            />

            <Input
              radius="md"
              isRequired
              className="max-w-[80%]"
              label="passing percentage of exam"
              labelPlacement="outside"
              name="passingPercentage"
              placeholder="enter your passing percentage here!"
              type="email"
              variant="bordered"
            />
            <Input
              radius="md"
              variant="flat"
              isRequired
              className="max-w-[80%]"
              label="Maximum marks"
              labelPlacement="outside"
              name="maxMarks"
              placeholder="Enter maxMarks"
              variant="bordered"
              type="email"
            />
            {questionsai.map((questionp, index) => (
              <div key={index}>
                <Input
                  radius="md"
                  variant="flat"
                  isReadOnly={readOnlyStates[index]}
                  className="max-w-[80%]"
                  defaultValue={
                    questionp.question + "(" + questionp.marks + ")"
                  }
                  label="Question"
                  type="email"
                  id={index}
                  variant="bordered"
                  onChange={handleUpdate}
                />
                <Button onPress={() => changeStateInput(index)}>
                  {readOnlyStates[index] == true ? (
                    <div>modify question</div>
                  ) : (
                    <div>save question</div>
                  )}
                </Button>
                {/*             
                //remove in deployement below button */}
                <Button onPress={() => printinput()}>print questions</Button>
              </div>
            ))}
            <div className="flex">
              <Input
                className=" w-fit min-w-[10vw] overflow-x  max-w-[50vw]"
                type="file"
                name="filee"
                accept="application/pdf"
                required
                onChange={handleFileChange}
              />
              <Input
                type="number"
                name="marks"
                className="mx-[5vh] w-[5h]"
                required
                label="Enter Maximum marks"
                labelPlacement="inside"
              ></Input>
            </div>
            <Button
              type="button"
              className=" w-[20vh]"
              onClick={uploadPDFToGemini}
            >
              Upload to Gemini
            </Button>
          </div>
        )}
        <div className="flex justify-center items-center w-full mt-4">
          <Button type="submit" variant="bordered">
            Submit
          </Button>
        </div>
      </Form>
    </div>
  );
};

export default Page;
