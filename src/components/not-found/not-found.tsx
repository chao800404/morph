import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { NotFoundIcon } from "../ui/icons/not-found-icon";

export const NotFound = () => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center">
      <NotFoundIcon />
      <h1 className="dark:text-neutral-400 mt-2">
        404 - There is no page at this address
      </h1>
      <p className="dark:text-neutral-500">
        The page you are looking for does not exist.
      </p>
      <div className="mt-5">
        <Button className="shadow-sm p-0 dark:bg-neutral-800 border text-white">
          <Link className="block px-2 py-1.5" to="/dashboard">
            Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
};
