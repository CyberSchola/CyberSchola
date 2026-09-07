"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form";
import { z } from "zod"
import InputField from "../InputField";

/* Schema for Form validation */
const schema = z.object({

  user: z.string().min(1, { error: 'Subject Name is required!' }),

  class: z.string().min(1, { message: 'Class is required!' }),

  teacher: z.string().min(1, { message: 'Teacher Name is required!' }),

  date: z.string().min(1, { message: 'Date is required!' }),

});

{ /* ZOD */ }
type Inputs = z.infer<typeof schema>


const AssignmentForm = ( { type, data }: { type: "create" | "update"; data?: any; }) => {
  
  { /* ZOD */ }
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Inputs> ({
    resolver: zodResolver(schema),
  });


  const onSubmit = handleSubmit( (data) => {
    console.log(data);
  } )

 
 return (
    
     /* FORM */ 
    <form className=" flex flex-col gap-8 " onSubmit={onSubmit} >

      { /* CONDITION FOR FORM HEADING */ }
      { type === "create" ? < h1 className="text-xl font-semibold">Create A New Assignment</h1> : < h1 className="text-xl font-semibold">Update Assignment</h1> }

      { /* FORM MODAL LABEL 1 */ }
      <span className="text-xs text-gray-400 font-medium">
        Assignment Information
      </span>

      { /* AUTHENTICATION INPUTS MAIN CONTAINER 1 */ }
      <div className="flex justify-between flex-wrap gap-4 ">

        { /* AUTHENTICATION INFROMATION INPUTS */ }

        <InputField label="Subject Name" name="user" defaultValue= {data?.subject} register={register} error={errors.user}  />   
         
        <InputField label="Class Name" name="class" defaultValue= {data?.class} register={register} error={errors.class} />

        <InputField label="Teacher Name" name="teacher" defaultValue= {data?.teacher} register={register} error={errors.teacher} />

        <InputField label="Due-Date" name="date" defaultValue= {data?.date} register={register} error={errors.date} />   

      </div>
      

      { /* UPDATE AND CREATE BUTTON */ }
      <button className="bg-blue-400 text-white p-2 rounded-md">
        { type === "create" ? "Create" : "Update" }
      </button>

    </form>

  )
}

export default AssignmentForm