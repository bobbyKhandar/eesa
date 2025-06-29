import { Form } from "@heroui/form";
import { Button } from "@heroui/button";
import { Textarea } from "@heroui/input";
import { useState } from "react";
import { postAnswers } from "@/geminiAi";
const QuestionnaireCsr = ({ questions, email }) => {
  const [answers, setAnswers] = useState(null);
  const [action, setAction] = useState(null);
  console.log(questions[0]);
  return (
    <div>
      hai{email}
      <Form
        className="w-full max-w-xs flex flex-col gap-4"
        validationBehavior="native"
        onReset={() => setAction("reset")}
        onSubmit={(e) => {
          e.preventDefault();
          let data = Object.fromEntries(new FormData(e.currentTarget));
          postAnswers(data, email);
          setAction(`submit ${JSON.stringify(data)}`);
        }}
      >
        {questions[3].examquestions.map((question, key) => {
          return (
            <Textarea
              isRequired
              errorMessage="Please enter a valid Answer"
              label={question}
              labelPlacement="outside"
              name={question}
              placeholder="Enter your Answer"
              type="text"
              key={key}
            />
          );
        })}
        <div className="flex gap-2">
          <Button color="primary" type="submit">
            Submit
          </Button>
          <Button type="reset" variant="flat">
            Reset
          </Button>
        </div>
        {action && (
          <div className="text-small text-default-500">
            Action: <code>{action}</code>
          </div>
        )}
      </Form>
    </div>
  );
};

export default QuestionnaireCsr;
