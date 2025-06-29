import { getQuestions } from "@/db";
import { useEffect, useState } from "react";
import QuestionnaireCsr from "./QuestionnaireCsr";
const Questionnaire = (email) => {
  const [questions, setQuestions] = useState(null);
  useEffect(() => {
    async function fetchData() {
      if (email != undefined || email != null) {
        setQuestions(await getQuestions(email.emailAddresses[0]));
        console.log("questions=" + questions);
      }
    }
    fetchData();
  }, [email]);

  return questions ? (
    <div>
      {console.log("questions=" + questions)}
      <QuestionnaireCsr
        questions={questions}
        email={email.emailAddresses[0]}
      ></QuestionnaireCsr>
    </div>
  ) : (
    <div>The Questions are being fetched..</div>
  );
};

export default Questionnaire;
