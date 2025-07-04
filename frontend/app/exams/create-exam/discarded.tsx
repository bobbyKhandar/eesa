import { Button } from "@heroui/button";
import { Card, CardFooter } from "@heroui/card";
import Image from "next/image";
import { Divider } from "@heroui/divider";
const aiexamephoto = "/ai-making-exam.svg";
const page = () => {
  return (
    <div className="overflow-hidden">
      Create an exam using..
      <Divider className="my-4 bg-white" />
      <div className="grid grid-flow-col grid-rows-2 mx-[20vh] overflow-y-hidden min-w-[100%]">
        <Card
          isFooterBlurred
          className="border-none m-0 max-w-fit "
          radius="lg"
        >
          <Image
            alt="Woman listing to music"
            className="object-cover"
            height={400}
            src={aiexamephoto}
            width={400}
          />
          <CardFooter className=" justify-center before:bg-white/10 border-white/20 border-1 overflow-hidden py-1 absolute before:rounded-xl rounded-large bottom-1 w-[calc(100%_-_8px)] shadow-small ml-1 z-10">
            <Button
              className="text-tiny flex  justify-center m-0 item-center text-white bg-black/20"
              color="default"
              radius="lg"
              size="sm"
              variant="flat"
            >
              Create an personal mock exam using ai
            </Button>
          </CardFooter>
        </Card>
        <Card
          isFooterBlurred
          className="border-none max-w-fit  w-[30vw]"
          radius="lg"
        >
          <Image
            alt="Woman listing to music"
            className="object-cover"
            height={400}
            src={aiexamephoto}
            width={400}
          />
          <CardFooter className=" justify-center before:bg-white/10 border-white/20 border-1 overflow-hidden py-1 absolute before:rounded-xl rounded-large bottom-1 w-[calc(100%_-_8px)] shadow-small ml-1 z-10">
            <Button
              className="text-tiny flex  justify-center item-center text-white bg-black/20"
              color="default"
              radius="lg"
              size="sm"
              variant="flat"
            >
              Create an personal mock exam using your own questions
            </Button>
          </CardFooter>
        </Card>{" "}
        <Card isFooterBlurred className="border-none max-w-fit  " radius="lg">
          <Image
            alt="Woman listing to music"
            className="object-cover"
            height={400}
            src={aiexamephoto}
            width={400}
          />
          <CardFooter className=" justify-center before:bg-white/10 border-white/20 border-1 overflow-hidden py-1 absolute before:rounded-xl rounded-large bottom-1  shadow-small z-10">
            <Button
              className="text-tiny flex  justify-center item-center text-white bg-black/20"
              color="default"
              radius="lg"
              size="sm"
              variant="flat"
            >
              Create an personal mock exam using ai
            </Button>
          </CardFooter>
        </Card>
        <Card
          isFooterBlurred
          className="border-none max-w-fit  w-[30vw]"
          radius="lg"
        >
          <Image
            alt="Woman listing to music"
            className="object-cover"
            height={400}
            src={aiexamephoto}
            width={400}
          />
          <CardFooter className=" justify-center before:bg-white/10 border-white/20 border-1 overflow-hidden py-1 absolute before:rounded-xl rounded-large bottom-1 w-[calc(100%_-_8px)] shadow-small ml-1 z-10">
            <Button
              className="text-tiny flex  justify-center item-center text-white bg-black/20"
              color="default"
              radius="lg"
              size="sm"
              variant="flat"
            >
              Create an personal mock exam using ai
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};

export default page;
