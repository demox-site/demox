import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { FunctionWorkspace } from "./functions/workspace";
import { useFunctionRoute, useFunctionWorkspace } from "./functions/function-context";
import { FunctionsHome, FunctionsSection } from "./functions/FunctionsHome";
import { FunctionDeploy } from "./functions/FunctionDeploy";
import { FunctionSecrets } from "./functions/FunctionSecrets";
import { FunctionDetail } from "./functions/FunctionDetail";

function FunctionsScreen() {
  const { copy, loadError } = useFunctionWorkspace();
  const { panel, functionId } = useFunctionRoute();
  return (
    <div className="stitch-page">
      <div className="site-page-head">
        <div>
          <h1 className="site-page-title">{copy.title}</h1>
          <p className="site-page-desc">{copy.subtitle}</p>
        </div>
      </div>
      {loadError && !functionId ? null : null}
      <div className="flex flex-col gap-6 sm:flex-row">
        <FunctionsSection />
        {functionId ? <FunctionDetail /> : panel === "new" ? <FunctionDeploy /> : panel === "secrets" ? <FunctionSecrets /> : <FunctionsHome />}
      </div>
    </div>
  );
}

export default function ProjectFunctionsPage() {
  return (
    <FunctionWorkspace>
      <FunctionsScreen />
    </FunctionWorkspace>
  );
}

export function LegacyFunctionRedirect() {
  const { projectId = "" } = useParams();
  const [params] = useSearchParams();
  const fn = params.get("fn");
  const target = fn
    ? `/console/projects/${projectId}/functions?fn=${encodeURIComponent(fn)}`
    : `/console/projects/${projectId}/functions`;
  return <Navigate to={target} replace />;
}
